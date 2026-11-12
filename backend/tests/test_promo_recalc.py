import json
from datetime import date, datetime, timezone
from decimal import Decimal

from conftest import FakeConnection, FakeEngine

from app.services.settings import common
from app.services.settings import promo_recalc as service


STAMP = datetime(2026, 11, 10, tzinfo=timezone.utc)
NOV_2026 = date(2026, 11, 1)
JUNE_2027 = date(2027, 6, 1)

MECHANICS = {
    "pct_off_15": {"label": "15% Off", "discount_pct": Decimal("15")},
    "pct_off_20": {"label": "20% Off", "discount_pct": Decimal("20")},
}


def _months(start, count):
    month = start
    for _ in range(count):
        yield month
        month = date(month.year + month.month // 12, month.month % 12 + 1, 1)


def _whole_month(promotion_id, month, mechanic):
    end = date.fromordinal(date(month.year + month.month // 12, month.month % 12 + 1, 1).toordinal() - 1)
    return {
        "customer_id": 1,
        "sku": "SKU-L",
        "promotion_id": promotion_id,
        "period_start": month,
        "period_end": end,
        "promo_type": "monthly",
        "promotion_mechanic": mechanic,
    }


def _clients_case_inputs():
    # 20% off sold every month Dec 2025 - Nov 2026; 15% off keyed in from Dec 2026.
    sold = list(_months(date(2025, 12, 1), 12))
    ahead = list(_months(date(2026, 12, 1), 13))
    promotions = [_whole_month(i, month, "20% Off") for i, month in enumerate(sold, 1)]
    promotions += [_whole_month(100 + i, month, "15% Off") for i, month in enumerate(ahead, 1)]
    return {
        "promotions": promotions,
        "units": {(1, "SKU-L"): {month: 100.0 for month in sold}},
        "sales_through": NOV_2026,
    }


class FakeAnchors:
    """promo_anchor_settings for one test: the customer's saved 20% off, plus what the run inserts."""

    def __init__(self):
        self.rows = [{
            "id": 1, "customer_id": 1, "sku_range": None, "promotion_mechanic": "20% Off",
            "anchor_pct": Decimal("20"), "source": "recommended", "effective_from": None, "updated_at": STAMP,
        }]
        self.inserted = []

    def read(self, conn):
        return list(self.rows)

    def insert(self, conn, values):
        self.inserted.append(values)
        self.rows.append({**values, "id": len(self.rows) + 1, "updated_at": STAMP})


def _install(monkeypatch, inputs=None):
    conn = FakeConnection()
    anchors = FakeAnchors()
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "lock_customer", lambda conn, customer_id: None)
    monkeypatch.setattr(common, "this_month", lambda: NOV_2026)
    monkeypatch.setattr(service.promo_moments, "customer_inputs", lambda conn, customer_id: inputs or _clients_case_inputs())
    monkeypatch.setattr(service.promo_moments, "sku_ranges", lambda conn: {"SKU-L": "Pants"})
    monkeypatch.setattr(service, "_discounts", lambda conn: MECHANICS)
    monkeypatch.setattr(service.promo_uplifts, "_lock", lambda conn, table: None)
    monkeypatch.setattr(service.promo_uplifts, "_anchor_rows", anchors.read)
    monkeypatch.setattr(service.promo_uplifts, "_insert_anchor", anchors.insert)
    return conn, anchors


# ---- recalculate_customer ----------------------------------------------------------


def test_the_clients_case_saves_15_off_from_june_2027_as_a_projected_anchor(monkeypatch):
    _, anchors = _install(monkeypatch)

    result = service.recalculate_customer(1)

    assert [(a["sku_range"], a["effective_from"], a["promotion_mechanic"], a["source"]) for a in anchors.inserted] == [
        (None, JUNE_2027, "15% Off", "projected"),
    ]
    assert anchors.inserted[0]["updated_by"] == service.PROJECTION_USER
    assert result["projected_anchors"] == 1


def test_real_and_planned_moments_replace_the_customers_rows(monkeypatch):
    conn, _ = _install(monkeypatch)

    service.recalculate_customer(1)

    delete_at = next(i for i, (sql, _) in enumerate(conn.calls) if sql.startswith("DELETE FROM promo_moment_calc"))
    insert_at = next(i for i, (sql, _) in enumerate(conn.calls) if sql.startswith("INSERT INTO promo_moment_calc"))
    rows = conn.calls[insert_at][1]
    assert delete_at < insert_at
    assert (sum(not row["planned"] for row in rows), sum(row["planned"] for row in rows)) == (12, 13)
    assert {row["anchor_id"] for row in rows if not row["planned"]} == {1}


def test_uplifts_are_saved_for_each_anchor_version_from_this_month(monkeypatch):
    conn, _ = _install(monkeypatch)

    service.recalculate_customer(1)

    (_, rows), = conn.sql_containing("INSERT INTO promo_uplift_calc")
    by_version = {row["anchor_id"]: row for row in rows if row["mechanic_key"] == "pct_off_20"}
    # 20% off is the anchor until June 2027, then +2% on the 15%-off anchor,
    # from the 2026 moments converted (placeholder relation, recorded).
    assert (by_version[1]["level"], by_version[1]["uplift_pct"]) == ("anchor", 0.0)
    assert (by_version[2]["level"], by_version[2]["uplift_pct"]) == ("measured_earlier", 2.0)
    explanation = json.loads(by_version[2]["explanation"])
    assert explanation["anchor"]["effective_from"] == "2027-06-01"
    assert {m["converted"]["source"] for m in explanation["moments"]} == {"placeholder"}


def test_a_rerun_with_nothing_new_writes_no_second_anchor(monkeypatch):
    _, anchors = _install(monkeypatch)

    service.recalculate_customer(1)
    service.recalculate_customer(1)

    assert len(anchors.inserted) == 1


def test_a_mechanic_the_sales_already_point_to_is_not_saved_as_a_projection(monkeypatch):
    # Saved: Buy 2 Get 25% Off. Sales so far (and ahead) say 20% off: that is
    # the Recommended anchor to adopt by hand, not a change the future brings.
    inputs = _clients_case_inputs()
    inputs["promotions"] = [p for p in inputs["promotions"] if p["promotion_mechanic"] == "20% Off"]
    _, anchors = _install(monkeypatch, inputs)
    anchors.rows[0].update(promotion_mechanic="Buy 2 Get 25% Off", anchor_pct=Decimal("25"))

    service.recalculate_customer(1)

    assert anchors.inserted == []


def test_a_projected_anchor_that_no_longer_holds_is_undone(monkeypatch):
    inputs = _clients_case_inputs()
    inputs["promotions"] = [p for p in inputs["promotions"] if p["promotion_mechanic"] == "20% Off"]
    _, anchors = _install(monkeypatch, inputs)
    anchors.rows.append({
        "id": 2, "customer_id": 1, "sku_range": None, "promotion_mechanic": "15% Off", "anchor_pct": Decimal("15"),
        "source": "projected", "effective_from": JUNE_2027, "updated_at": STAMP,
    })

    service.recalculate_customer(1)

    assert [(a["effective_from"], a["promotion_mechanic"]) for a in anchors.inserted] == [(JUNE_2027, "20% Off")]


def test_a_customer_with_no_anchor_saved_is_not_projected(monkeypatch):
    _, anchors = _install(monkeypatch)
    anchors.rows = []

    service.recalculate_customer(1)

    assert anchors.inserted == []


def test_the_status_is_saved_with_no_error(monkeypatch):
    conn, _ = _install(monkeypatch)

    service.recalculate_customer(1)

    (sql, params), = conn.sql_containing("INSERT INTO promo_calc_status")
    assert "last_error = NULL" in sql
    assert params == {"customer_id": 1, "warnings": "[]"}


# ---- process_pending -----------------------------------------------------------------


def _install_queue(monkeypatch, claimed, customers=(1, 2)):
    def respond(sql, params):
        if sql.startswith("UPDATE promo_recalc_requests"):
            return [(customer_id,) for customer_id in claimed]
        if sql.startswith("SELECT customer_id FROM customers"):
            return [(customer_id,) for customer_id in customers]
        return []

    conn = FakeConnection(respond)
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(service.events, "enqueue_best_effort", lambda recorded: None)
    return conn


def test_each_customer_is_worked_out_once_however_many_saves_asked(monkeypatch):
    _install_queue(monkeypatch, claimed=[2, 1, 2])
    done = []
    monkeypatch.setattr(service, "recalculate_customer", lambda customer_id: done.append(customer_id) or {"customer_id": customer_id})

    service.process_pending()

    assert done == [1, 2]


def test_a_request_for_every_customer_works_out_every_customer(monkeypatch):
    _install_queue(monkeypatch, claimed=[None, 1], customers=(1, 2, 3))
    done = []
    monkeypatch.setattr(service, "recalculate_customer", lambda customer_id: done.append(customer_id) or {})

    service.process_pending()

    assert done == [1, 2, 3]


def test_a_failing_customer_keeps_its_error_and_is_queued_again_while_the_others_finish(monkeypatch):
    conn = _install_queue(monkeypatch, claimed=[1, 2])

    def recalc(customer_id):
        if customer_id == 1:
            raise RuntimeError("bad data")
        return {"customer_id": customer_id}

    monkeypatch.setattr(service, "recalculate_customer", recalc)

    result = service.process_pending()

    assert result["customers"] == [{"customer_id": 2}]
    assert result["failed"] == [{"customer_id": 1, "error": "RuntimeError: bad data"}]
    (_, status), = conn.sql_containing("INSERT INTO promo_calc_status")
    assert status == {"customer_id": 1, "last_error": "RuntimeError: bad data"}
    (_, retry), = conn.sql_containing("INSERT INTO promo_recalc_requests")
    assert (retry["customer_id"], retry["reason"]) == (1, "retry")


def test_a_customer_deleted_since_its_request_is_skipped(monkeypatch):
    _install_queue(monkeypatch, claimed=[1])

    def gone(customer_id):
        raise common.CustomerNotFoundError("Customer 1 does not exist.")

    monkeypatch.setattr(service, "recalculate_customer", gone)

    assert service.process_pending() == {"customers": [], "failed": []}


def test_nothing_pending_does_nothing(monkeypatch):
    _install_queue(monkeypatch, claimed=[])
    monkeypatch.setattr(service, "recalculate_customer", lambda customer_id: (_ for _ in ()).throw(AssertionError()))

    assert service.process_pending() == {"customers": [], "failed": []}
