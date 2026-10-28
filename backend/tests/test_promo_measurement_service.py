from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.settings import common
from app.services.settings import promo_measurement as service


CONFIG = dict(service.DEFAULT_CONFIG)
WINDOW = (date(2025, 1, 1), date(2025, 12, 31))


class RecordingDatabase:
    """
    Answers the measurement's writes: every INSERT ... RETURNING gets the
    next id, the advisory lock is free unless told otherwise, and reads the
    tests don't stub come back empty. Any DELETE, or an UPDATE that isn't a
    supersede, fails the test (everything is append-only).
    """

    def __init__(self, lock_free=True, last_fingerprint=None, note=None):
        self.next_id = 100
        self.lock_free = lock_free
        self.last_fingerprint = last_fingerprint
        self.note = note

    def respond(self, sql, params):
        if sql.startswith("DELETE") or (sql.startswith("UPDATE") and "superseded_at = now()" not in sql):
            raise AssertionError(f"append-only: {sql}")
        if "pg_try_advisory_xact_lock" in sql:
            return [(self.lock_free,)]
        if "SELECT input_fingerprint FROM promo_measurement_runs" in sql:
            return [(self.last_fingerprint,)] if self.last_fingerprint else []
        if "FROM promo_uplift_pending_notes WHERE id = :note_id FOR UPDATE" in sql:
            return [self.note] if self.note else []
        if "RETURNING" in sql:
            self.next_id += 1
            return [(self.next_id,)]
        return []


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


def _setting(key, scope="all", source="rule_based", uplift="4", customer_id=None, sku=None, row_id=1, discount="30"):
    return {
        "id": row_id,
        "mechanic_key": key,
        "mechanic_label": key,
        "effective_discount_pct": Decimal(discount) if discount is not None else None,
        "scope": scope,
        "customer_id": customer_id,
        "customer_name": "fairprice" if customer_id else None,
        "sku_range": None,
        "sku": sku,
        "uplift_pct": Decimal(uplift),
        "source": source,
        "kind": "promotion",
        "evidence_months": None,
        "note": None,
        "changed_by": "seed",
        "changed_at": None,
        "superseded_at": None,
        "archived_at": None,
    }


def _target(sku=None, blended=6.0, hold=False, key="pct_off_30"):
    return {
        "customer_id": 1, "sku": sku, "mechanic_key": key, "method": "trend" if sku else None,
        "n": 4.0 if sku else None, "big_n": 5.0, "sku_own_pct": 8.0 if sku else None, "customer_own_pct": 7.0,
        "rule_based_pct": 4.0, "starting_weight": 3.0, "blended_pct": blended, "backtest_pct": -5.0 if hold else 3.0,
        "backtest_months": 2.0, "hold": hold, "evidence_months": 4.0 if sku else 5.0,
    }


def _inputs(settings, notes=None):
    return {
        "window_start": WINDOW[0], "window_end": WINDOW[1], "settings": settings,
        "sku_ranges": {"SKU-L": "Pants"}, "notes": notes or {}, "anchor_views": [], "anchor_rows": {},
        "rule_rate": Decimal("0.4"),
    }


def _measured(*targets, to_create=None):
    return {"targets": list(targets), "to_create": to_create or {}, "warnings": [], "reach": {1: 0.67}}


# ---- _measure (no database) -----------------------------------------------------------


def _measure_inputs():
    months = [date(2025, m, 1) for m in range(1, 9)]
    # Flat sales except June, when a 10-day side offer lifted the month 5%.
    units = {month: (105.0 if month.month == 6 else 100.0) for month in months}
    return {
        "training": {1: {"SKU-L": units}},
        "promotions": {1: [
            {"promotion_id": 1, "promo_type": "monthly", "promotion_mechanic": "20% Off", "mechanic_key": "pct_off_20",
             "voucher": 0, "period_start": date(2025, 1, 1), "period_end": date(2025, 8, 31),
             "stores": {"1|S1"}, "skus": {"SKU-L"}},
            {"promotion_id": 2, "promo_type": "side_offer", "promotion_mechanic": "30% Off", "mechanic_key": "pct_off_30",
             "voucher": 0, "period_start": date(2025, 6, 1), "period_end": date(2025, 6, 10),
             "stores": {"1|S1"}, "skus": {"SKU-L"}},
        ]},
        "store_units": {(1, "SKU-L"): {"1|S1": 800.0}},
        "customer_stores": {1: {"1|S1"}},
        "backtest": None,
        "settings": [_setting("pct_off_20", discount="20", uplift="0"), _setting("pct_off_30", row_id=2)],
        "anchors": {1: Decimal("20")},
        "rule_rate": Decimal("0.4"),
        "labels": ["20% Off", "30% Off", "35% Off", "Free tote bag"],
    }


def test_measure_finds_the_side_offer_and_steadies_it_towards_the_rule_based_uplift():
    result = service._measure(_measure_inputs(), CONFIG)

    sku = next(t for t in result["targets"] if t["sku"] == "SKU-L" and t["mechanic_key"] == "pct_off_30")
    customer = next(t for t in result["targets"] if t["sku"] is None and t["mechanic_key"] == "pct_off_30")
    # A third of a month at +5% is +15% as a full month; with only 8 months the
    # lift also raises the trend line and the average month a little, so part
    # of it is absorbed (a stated limitation) and it lands just under.
    assert 10 < sku["sku_own_pct"] < 15
    assert sku["n"] == pytest.approx(1 / 3)
    # rule-based +4 at a 20% anchor; one month of evidence leans on it.
    assert customer["rule_based_pct"] == 4.0
    assert 4.0 < customer["blended_pct"] < sku["sku_own_pct"]


def test_measure_leaves_a_mechanic_running_every_month_without_evidence():
    result = service._measure(_measure_inputs(), CONFIG)

    every_month = next(t for t in result["targets"] if t["sku"] is None and t["mechanic_key"] == "pct_off_20")
    assert every_month["blended_pct"] is None
    assert not any(t["sku"] and t["mechanic_key"] == "pct_off_20" for t in result["targets"])


def test_measure_creates_readable_new_mechanics_and_warns_about_unreadable_ones():
    result = service._measure(_measure_inputs(), CONFIG)

    assert result["to_create"] == {"pct_off_35": {"label": "35% Off", "discount": Decimal("35")}}
    assert any("Free tote bag" in warning for warning in result["warnings"])


def test_measure_with_no_promotions_writes_nothing_to_measure():
    inputs = {**_measure_inputs(), "promotions": {}, "labels": []}

    assert service._measure(inputs, CONFIG)["targets"] == []


# ---- _apply (what gets written) ---------------------------------------------------------


def test_a_new_blended_customer_uplift_is_inserted_as_measured(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, results = service._apply(conn, _measured(_target()), _inputs([_setting("pct_off_30")]), CONFIG)

    (_, params), = conn.sql_containing("INSERT INTO promo_uplift_settings")
    assert params["scope"] == "customer"
    assert params["source"] == "measured"
    assert params["uplift_pct"] == Decimal("6.0")
    assert params["changed_by"] == "measurement"
    assert counts["applied"] == 1
    assert results[0][1] == "applied"


def test_an_unchanged_measured_value_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "measured", "6.0", customer_id=1, row_id=7)]

    counts, _ = service._apply(conn, _measured(_target()), _inputs(settings), CONFIG)

    assert counts["unchanged"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_typed_value_is_never_overwritten_and_gets_a_note(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]

    counts, _ = service._apply(conn, _measured(_target()), _inputs(settings), CONFIG)

    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []
    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "open"
    assert note["user_value"] == Decimal("10")
    assert note["measured_value"] == Decimal("6.0")
    assert counts["estimate_pending"] == 1


def test_no_blended_sku_uplift_is_written_under_a_typed_blended_customer_uplift(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]

    counts, results = service._apply(conn, _measured(_target(sku="SKU-L")), _inputs(settings), CONFIG)

    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []
    assert results[0][1] == "estimate_pending"


def test_a_backtest_disagreement_holds_the_previous_value(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, _ = service._apply(conn, _measured(_target(hold=True)), _inputs([_setting("pct_off_30")]), CONFIG)

    assert counts["held_backtest"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_no_evidence_leaves_the_setting_alone(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, _ = service._apply(conn, _measured(_target(blended=None)), _inputs([_setting("pct_off_30")]), CONFIG)

    assert counts["no_evidence"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_archived_mechanics_are_not_measured(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    archived = {**_setting("pct_off_30"), "archived_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}

    counts, _ = service._apply(conn, _measured(_target()), _inputs([archived]), CONFIG)

    assert counts["skipped"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_declined_note_is_only_raised_again_after_a_two_point_move(monkeypatch):
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]
    kept = {
        "id": 50, "note_type": "uplift", "customer_id": 1, "mechanic_key": "pct_off_30", "sku": None,
        "setting_id": 7, "anchor_id": None, "user_value": Decimal("10"), "measured_value": Decimal("6"),
        "evidence_months": Decimal("5"), "status": "kept_mine", "declined_value": Decimal("6"),
    }
    notes = {("uplift", 1, "pct_off_30", None): kept}

    conn = _install(monkeypatch, RecordingDatabase())
    service._apply(conn, _measured(_target(blended=7.0)), _inputs(settings, notes), CONFIG)
    assert conn.sql_containing("INSERT INTO promo_uplift_pending_notes") == []

    conn = _install(monkeypatch, RecordingDatabase())
    service._apply(conn, _measured(_target(blended=8.0)), _inputs(settings, notes), CONFIG)
    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "open"


def test_new_mechanics_are_created_as_all_customer_rule_based_uplifts(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    measured = _measured(to_create={"pct_off_35": {"label": "35% Off", "discount": Decimal("35")}})

    counts, _ = service._apply(conn, measured, _inputs([]), CONFIG)

    (_, params), = conn.sql_containing("INSERT INTO promo_uplift_settings")
    assert params["mechanic_key"] == "pct_off_35"
    assert params["scope"] == "all"
    assert params["source"] == "rule_based"
    assert params["uplift_pct"] == Decimal("6")
    assert counts["mechanics_created"] == 1


# ---- the run ------------------------------------------------------------------------------


def _stub_reads(monkeypatch, inputs=None):
    monkeypatch.setattr(service, "_read_training", lambda: [
        {"customer_id": 1, "sku": "SKU-L", "month_year": date(2025, 1, 1), "quantity_cartons": 100.0},
    ])
    monkeypatch.setattr(service, "_read_backtest_errors", lambda: (None, ["no backtest"]))
    monkeypatch.setattr(service, "_read_config", lambda conn: dict(CONFIG))
    base = {
        "window_start": WINDOW[0], "window_end": WINDOW[1], "training": {}, "backtest": None, "settings": [],
        "anchor_views": [], "anchors": {}, "anchor_rows": {}, "rule_rate": Decimal("0.4"),
        "promotions": {}, "store_units": {},
        "customer_stores": {}, "sku_ranges": {}, "labels": [], "notes": {},
    }
    monkeypatch.setattr(service, "_read_inputs", lambda conn, training, backtest: {**base, **(inputs or {})})


def test_unchanged_inputs_record_a_skipped_run_and_nothing_else(monkeypatch):
    _stub_reads(monkeypatch)
    fingerprint = service.mrules.fingerprint(service._fingerprint_payload(
        {"training": {}, "backtest": None, "settings": [], "anchors": {}, "rule_rate": Decimal("0.4"), "promotions": {},
         "store_units": {}, "labels": []}, CONFIG))
    conn = _install(monkeypatch, RecordingDatabase(last_fingerprint=fingerprint))

    summary = service.run_measurement("scheduler")

    assert summary["status"] == "skipped_unchanged"
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "skipped_unchanged"
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_run_writes_its_run_row_once_with_the_counts(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase())

    summary = service.run_measurement("button")

    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "succeeded"
    assert run["triggered_by"] == "button"
    assert '"applied": 0' in run["counts"]
    assert summary["warnings"] == ["no backtest"]


def test_a_second_run_at_the_same_time_is_refused(monkeypatch):
    _stub_reads(monkeypatch)
    _install(monkeypatch, RecordingDatabase(lock_free=False))

    with pytest.raises(service.MeasurementRunningError):
        service.run_measurement("button")


def test_a_failure_is_recorded_as_a_failed_run_and_raised(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase())

    def broken(inputs, config):
        raise RuntimeError("boom")

    monkeypatch.setattr(service, "_measure", broken)

    with pytest.raises(RuntimeError):
        service.run_measurement("scheduler")

    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert "boom" in run["error"]


def test_an_empty_training_input_fails_loudly(monkeypatch):
    _stub_reads(monkeypatch)
    monkeypatch.setattr(service, "_read_training", lambda: [])
    _install(monkeypatch, RecordingDatabase())

    with pytest.raises(ValueError):
        service.run_measurement("scheduler")


def test_an_unknown_trigger_is_rejected_before_anything_runs():
    with pytest.raises(ValueError):
        service.run_measurement("cron")


# ---- notes --------------------------------------------------------------------------------


def _open_note(**overrides):
    return {
        "id": 50, "note_type": "uplift", "customer_id": 1, "mechanic_key": "pct_off_30", "sku": None,
        "setting_id": 7, "anchor_id": None, "user_value": Decimal("10"), "measured_value": Decimal("6"),
        "evidence_months": Decimal("5"), "result_id": None, "status": "open", "declined_value": None,
        "superseded_at": None, **overrides,
    }


def test_keep_mine_records_the_declined_value(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase(note=_open_note()))

    service.keep_mine(50, "sandra")

    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "kept_mine"
    assert note["declined_value"] == Decimal("6")
    assert note["decided_by"] == "sandra"


def test_deciding_a_note_twice_is_a_conflict_and_a_missing_one_not_found(monkeypatch):
    _install(monkeypatch, RecordingDatabase(note=_open_note(status="kept_mine")))
    with pytest.raises(service.NoteConflictError):
        service.keep_mine(50)

    _install(monkeypatch, RecordingDatabase(note=None))
    with pytest.raises(service.NoteNotFoundError):
        service.use_measured(50)


# ---- status ---------------------------------------------------------------------------------


def test_next_due_is_the_next_4am_in_singapore():
    # 27 Oct 21:00 UTC = 28 Oct 05:00 SGT -> next run 29 Oct 04:00 SGT = 28 Oct 20:00 UTC.
    now = datetime(2026, 10, 27, 21, 0, tzinfo=timezone.utc)

    assert service._next_due(now) == datetime(2026, 10, 28, 20, 0, tzinfo=timezone.utc)


# ---- the rule's rate -------------------------------------------------------------


def test_a_rate_change_changes_the_fingerprint():
    base = {"training": {}, "backtest": None, "settings": [], "anchors": {}, "promotions": {},
            "store_units": {}, "labels": []}

    at_04 = service.mrules.fingerprint(service._fingerprint_payload({**base, "rule_rate": Decimal("0.4")}, CONFIG))
    at_06 = service.mrules.fingerprint(service._fingerprint_payload({**base, "rule_rate": Decimal("0.6")}, CONFIG))

    assert at_04 != at_06


def test_the_rule_based_starting_point_uses_the_rate_but_not_for_the_voucher():
    row = _setting("pct_off_30")
    voucher = _setting("voucher", uplift="3", discount=None)

    assert service._rule_based_start(row, "pct_off_30", Decimal("25"), Decimal("0.4")) == 2.0
    assert service._rule_based_start(row, "pct_off_30", Decimal("25"), Decimal("0.6")) == 3.0
    assert service._rule_based_start(voucher, "voucher", Decimal("25"), Decimal("0.6")) == 3.0
