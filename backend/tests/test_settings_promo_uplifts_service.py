from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.settings import common
from app.services.settings import promo_uplifts as service


STAMP = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)

SEED = [
    ("pct_off_20", "20% Off", "20", "0"),
    ("pct_off_30", "30% Off", "30", "4"),
    ("b1g1", "Buy 1 Get 1 Free", "50", "12"),
    ("voucher", "Voucher", None, "3"),
]


class FakePromoUpliftDatabase:
    """
    In-memory customers, skus, promotions and both settings tables,
    answering the statements the service sends. The settings tables are
    append-only: any UPDATE or DELETE fails the test.
    """

    def __init__(self):
        self.customers = {1: "fairprice", 2: "giant"}
        self.skus = {"Aire Pants L": {"sku": "SKU-L", "sku_range": "Pants"}}
        self.promotions = []
        self.promotion_skus = []
        self.uplifts = []
        self.anchors = []
        for key, label, discount, uplift in SEED:
            self.add_uplift(key, label, discount, uplift, updated_by="seed")
        self.add_anchor(None, "20", "manual", "seed")
        # promo_moments.anchor_recommendations, keyed (customer_id, sku_range).
        self.recommendations = {}
        # promo_moment_calc's (customer_id, sku, mechanic_key): what official promotions use.
        self.moment_mechanics = []

    # ---- helpers for tests -----------------------------------------------------

    def _stamp(self):
        return STAMP + timedelta(minutes=len(self.uplifts) + len(self.anchors))

    # `key` and `scope` are what the service derives from the label and the
    # target; they are kept here so the tests read like the rows they mean.
    def add_uplift(self, key, label, discount, uplift, scope="all", customer_id=None,
                   sku_range=None, sku=None, source="placeholder", updated_by="aireos", note=None):
        row = {
            "uplift_id": len(self.uplifts) + 1,
            "customer_id": customer_id,
            "sku_range": sku_range,
            "sku": sku,
            "promotion_mechanic": label,
            "effective_discount_pct": Decimal(discount) if discount is not None else None,
            "uplift_pct": Decimal(uplift) if uplift is not None else None,
            "source": source,
            "note": note,
            "updated_by": updated_by,
            "updated_at": self._stamp(),
        }
        self.uplifts.append(row)
        return {**row, "id": row["uplift_id"]}

    def add_anchor(self, customer_id, anchor_pct, source, updated_by="aireos", sku_range=None, mechanic=None,
                   effective_from=None):
        row = {
            "anchor_id": len(self.anchors) + 1,
            "customer_id": customer_id,
            "sku_range": sku_range,
            "promotion_mechanic": mechanic,
            "anchor_pct": Decimal(anchor_pct) if anchor_pct is not None else None,
            "source": source,
            "effective_from": effective_from,
            "updated_by": updated_by,
            "updated_at": self._stamp(),
        }
        self.anchors.append(row)
        return row

    def add_promotion(self, customer_id, start, end, mechanic, promo_type="monthly", skus=()):
        promotion_id = len(self.promotions) + 1
        self.promotions.append({
            "customer_id": customer_id,
            "promotion_id": promotion_id,
            "period_start": start,
            "period_end": end,
            "promo_type": promo_type,
            "promotion_mechanic": mechanic,
        })
        self.promotion_skus.extend((promotion_id, sku) for sku in skus)

    def current_uplifts(self, key):
        """Newest row per target for one mechanic, as the service picks them, with `id` like the API."""

        newest = {}
        for row in self.uplifts:
            if service.rules.mechanic_key(row["promotion_mechanic"]) != key:
                continue
            target = (row["customer_id"], row["sku_range"], row["sku"])
            if target not in newest or (row["updated_at"], row["uplift_id"]) > (
                newest[target]["updated_at"], newest[target]["uplift_id"]
            ):
                newest[target] = row
        return [{**row, "id": row["uplift_id"]} for row in newest.values() if row["source"] != "removed"]

    # ---- statements --------------------------------------------------------------

    def respond(self, sql, params):
        params = params or {}

        if sql.startswith(("UPDATE", "DELETE")):
            raise AssertionError(f"settings tables are append-only: {sql}")

        if sql.startswith("LOCK TABLE"):
            return []

        if "FROM promo_moment_calc m" in sql:
            ranges = {row["sku"]: row["sku_range"] for row in self.skus.values()}
            return [
                {"customer_id": customer_id, "sku_range": ranges.get(sku), "mechanic_key": key}
                for customer_id, sku, key in sorted(set(self.moment_mechanics))
            ]

        if sql.startswith("INSERT INTO promo_uplift_settings"):
            row = self.add_uplift(
                None, params["promotion_mechanic"], params["effective_discount_pct"], params["uplift_pct"],
                customer_id=params["customer_id"], sku_range=params["sku_range"], sku=params["sku"],
                source=params["source"], updated_by=params["updated_by"], note=params["note"],
            )
            return [(row["uplift_id"],)]

        if sql.startswith("INSERT INTO promo_anchor_settings"):
            self.add_anchor(
                params["customer_id"], params["anchor_pct"], params["source"], params["updated_by"],
                params["sku_range"], params["promotion_mechanic"], params["effective_from"],
            )
            return []

        if "FOR NO KEY UPDATE" in sql:
            return [{"customer_id": params["customer_id"]}] if params["customer_id"] in self.customers else []

        if "FROM customers WHERE customer_name = :customer_name" in sql:
            return [
                {"customer_id": i, "customer_name": name}
                for i, name in self.customers.items()
                if name == params["customer_name"]
            ]

        if sql.startswith("SELECT customer_id, customer_name FROM customers"):
            wanted = params.get("customer_id")
            rows = [{"customer_id": i, "customer_name": n} for i, n in self.customers.items()]
            rows = [r for r in rows if wanted is None or r["customer_id"] == wanted]
            return sorted(rows, key=lambda r: r["customer_name"])

        if "FROM promotions p JOIN promotion_stores" in sql:
            wanted = params.get("customer_id")
            return [p for p in self.promotions if wanted is None or p["customer_id"] == wanted]

        if "FROM promotion_skus pk JOIN skus sk" in sql:
            by_sku = {row["sku"]: row["sku_range"] for row in self.skus.values()}
            return sorted({(pid, by_sku[sku]) for pid, sku in self.promotion_skus if by_sku.get(sku)})

        if "FROM promotions WHERE promotion_mechanic IS NOT NULL" in sql:
            counts = {}
            for p in self.promotions:
                counts[p["promotion_mechanic"]] = counts.get(p["promotion_mechanic"], 0) + 1
            return [{"promotion_mechanic": m, "promotions": n} for m, n in counts.items()]

        if sql.startswith("SELECT DISTINCT sku_range FROM skus"):
            return [(r,) for r in sorted({row["sku_range"] for row in self.skus.values() if row["sku_range"]})]

        if "FROM skus" in sql and "sku IS DISTINCT FROM sku_range" in sql:
            return [{"product_name": name, **row} for name, row in self.skus.items()]

        if "FROM skus" in sql:
            row = self.skus.get(params["product_name"])
            return [row] if row else []

        if "FROM promo_anchor_settings" in sql:
            return [{**row, "id": row["anchor_id"]} for row in self.anchors]

        if "FROM promo_uplift_settings u" in sql:
            return [
                {**row, "id": row["uplift_id"], "customer_name": self.customers.get(row["customer_id"])}
                for row in self.uplifts
            ]

        raise AssertionError(f"unexpected statement: {sql}")


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    monkeypatch.setattr(service.promo_moments, "anchor_recommendations", lambda conn: db.recommendations)
    return conn


def _recommend(db, customer_id, sku_range, key, months=6, window_months=10):
    db.recommendations[(customer_id, sku_range)] = {
        "mechanic_key": key,
        "mechanic_label": key,
        "months": months,
        "window_months": window_months,
    }


def _uplift_of(result, key):
    return next(u["uplift_pct"] for u in result["uplifts"] if u["mechanic_key"] == key)


# ---- anchor ----------------------------------------------------------------------


def test_with_nothing_saved_a_customer_uses_the_all_customers_anchor_and_its_ranges_follow(monkeypatch):
    db = FakePromoUpliftDatabase()
    _recommend(db, 1, "Pants", "pct_off_30")
    _install(monkeypatch, db)

    anchor = service.get_anchor(1)
    pants = anchor["ranges"][0]

    assert (anchor["anchor_pct"], anchor["source"]) == (20.0, "default")
    # A recommendation is shown, never used until it is adopted.
    assert (pants["anchor_pct"], pants["source"]) == (20.0, "customer")
    assert pants["recommended"] == {
        "mechanic_key": "pct_off_30", "mechanic_label": "30% Off", "anchor_pct": 30.0, "months": 6,
    }
    assert pants["recommendation_differs"] is True


def test_adopting_saves_the_recommended_mechanic_and_its_discount(monkeypatch):
    db = FakePromoUpliftDatabase()
    _recommend(db, 1, "Pants", "pct_off_30")
    _install(monkeypatch, db)

    result = service.adopt_anchor(1, "Pants")
    pants = result["anchor"]["ranges"][0]

    assert result["changed"] is True
    assert (pants["anchor_pct"], pants["mechanic_label"], pants["source"]) == (30.0, "30% Off", "recommended")
    assert pants["recommendation_differs"] is False
    assert (db.anchors[-1]["promotion_mechanic"], db.anchors[-1]["anchor_pct"]) == ("30% Off", Decimal("30"))
    # Adopting again writes nothing.
    assert service.adopt_anchor(1, "Pants")["changed"] is False


def test_a_saved_anchor_does_not_move_when_the_recommendation_does(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "30", "recommended", sku_range="Pants", mechanic="30% Off")
    _recommend(db, 1, "Pants", "b1g1")
    _install(monkeypatch, db)

    pants = service.get_anchor(1)["ranges"][0]

    assert (pants["anchor_pct"], pants["mechanic_label"]) == (30.0, "30% Off")
    assert pants["recommended"]["mechanic_label"] == "Buy 1 Get 1 Free"
    assert pants["recommendation_differs"] is True


def test_an_anchor_can_be_overwritten_with_a_mechanic_its_promotions_use_whatever_the_moments(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.moment_mechanics.append((1, "SKU-L", "pct_off_30"))
    _recommend(db, 1, "Pants", "pct_off_20", window_months=10)
    _install(monkeypatch, db)

    saved = service.overwrite_anchor(1, "pct_off_30", sku_range="Pants")
    pants = saved["anchor"]["ranges"][0]

    assert (pants["anchor_pct"], pants["mechanic_label"], pants["source"]) == (30.0, "30% Off", "manual")
    assert (db.anchors[-1]["promotion_mechanic"], db.anchors[-1]["anchor_pct"]) == ("30% Off", Decimal("30"))
    assert service.overwrite_anchor(1, "pct_off_30", sku_range="Pants")["changed"] is False


def test_an_overwrite_with_a_mechanic_no_official_promotion_uses_is_refused(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.moment_mechanics.append((1, "SKU-L", "pct_off_30"))
    _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Promotions page"):
        service.overwrite_anchor(1, "b1g1", sku_range="Pants")
    assert len(db.anchors) == 1


def test_mechanic_options_are_the_ones_official_promotions_use_that_have_a_discount(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.moment_mechanics += [(1, "SKU-L", "b1g1"), (1, "SKU-L", "pct_off_30"), (1, "SKU-L", "voucher")]
    _install(monkeypatch, db)

    anchor = service.get_anchor(1)

    # The voucher has no discount, so it can't be an anchor; cheapest first.
    assert [item["mechanic_key"] for item in anchor["ranges"][0]["mechanic_options"]] == ["pct_off_30", "b1g1"]
    assert anchor["mechanic_options"] == anchor["ranges"][0]["mechanic_options"]
    assert service.get_anchor(2)["mechanic_options"] == []


def test_adopting_with_too_few_moments_is_a_conflict(monkeypatch):
    db = FakePromoUpliftDatabase()
    _recommend(db, 1, "Pants", None, window_months=2)
    _install(monkeypatch, db)

    with pytest.raises(service.UpliftSettingConflictError):
        service.adopt_anchor(1, "Pants")
    assert len(db.anchors) == 1


def test_a_range_follows_its_customers_saved_anchor(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.skus["Aire Tape M"] = {"sku": "SKU-TM", "sku_range": "Tape"}
    db.add_anchor(1, "25", "recommended", mechanic="25% Off")
    db.add_anchor(1, "30", "recommended", sku_range="Pants", mechanic="30% Off")
    _install(monkeypatch, db)

    ranges = {item["sku_range"]: item for item in service.get_anchor(1)["ranges"]}

    assert (ranges["Pants"]["anchor_pct"], ranges["Pants"]["source"]) == (30.0, "recommended")
    assert (ranges["Tape"]["anchor_pct"], ranges["Tape"]["source"]) == (25.0, "customer")
    assert ranges["Tape"]["mechanic_label"] == "25% Off"


def test_seeding_lists_todays_recommendations_and_writes_only_when_applied(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(2, "20", "recommended", mechanic="20% Off")
    _recommend(db, 1, None, "pct_off_30")
    _recommend(db, 1, "Pants", "b1g1")
    _recommend(db, 2, None, "pct_off_30")
    _recommend(db, 2, "Pants", None, window_months=1)
    _install(monkeypatch, db)

    planned = service.seed_anchors()
    assert [(p["customer_name"], p["sku_range"], p["promotion_mechanic"]) for p in planned] == [
        ("fairprice", None, "30% Off"),
        ("fairprice", "Pants", "Buy 1 Get 1 Free"),
    ]
    assert len(db.anchors) == 2

    service.seed_anchors(apply=True)
    assert [(r["customer_id"], r["sku_range"], r["source"]) for r in db.anchors[2:]] == [
        (1, None, "recommended"),
        (1, "Pants", "recommended"),
    ]


def test_the_fallback_anchor_is_typed_and_used_wherever_nothing_is_saved(monkeypatch):
    db = FakePromoUpliftDatabase()
    monkeypatch.setattr(common, "this_month", lambda: NOV_2026)
    _install(monkeypatch, db)

    result = service.set_fallback_anchor(Decimal("30"))

    assert result["changed"] is True
    assert (result["fallback"]["anchor_pct"], result["fallback"]["effective_from"]) == (30.0, "2026-11-01")
    assert db.anchors[-1]["effective_from"] == NOV_2026
    assert service.get_anchor(2)["anchor_pct"] == 30.0
    assert service.list_anchors()["fallback"]["anchor_pct"] == 30.0
    assert service.set_fallback_anchor(Decimal("30.00"))["changed"] is False


def test_the_fallbacks_history_is_its_own(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "30", "recommended", mechanic="30% Off")
    _install(monkeypatch, db)

    history = service.anchor_history(None)

    assert [(row["anchor_pct"], row["is_current"]) for row in history] == [(20.0, True)]


def test_range_anchors_need_a_catalogue_range(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.moment_mechanics.append((1, "SKU-L", "pct_off_30"))
    _install(monkeypatch, db)

    with pytest.raises(ValueError):
        service.overwrite_anchor(1, "pct_off_30", sku_range="Socks")
    with pytest.raises(ValueError):
        service.adopt_anchor(1, sku_range="Socks")
    assert len(db.anchors) == 1


def test_anchor_history_is_per_target_and_newest_first(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "30", "recommended", sku_range="Pants", mechanic="30% Off")
    db.add_anchor(1, "25", "manual", sku_range="Pants")
    _install(monkeypatch, db)

    history = service.anchor_history(1, "Pants")

    assert [(row["source"], row["mechanic_label"]) for row in history] == [("manual", None), ("recommended", "30% Off")]
    assert [row["is_current"] for row in history] == [True, False]
    assert service.anchor_history(1) == []


# ---- anchor versions by month (effective_from) ----------------------------------


NOV_2026 = date(2026, 11, 1)
MAY_2027 = date(2027, 5, 1)


def _twenty_then_fifteen(monkeypatch, month=NOV_2026):
    # The client's case: 20% off now, 15% off decided from May 2027.
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "20", "recommended", mechanic="20% Off")
    db.add_anchor(1, "15", "projected", mechanic="15% Off", effective_from=MAY_2027)
    monkeypatch.setattr(common, "this_month", lambda: month)
    _install(monkeypatch, db)
    return db


def test_a_change_saved_for_a_later_month_is_upcoming_not_current(monkeypatch):
    _twenty_then_fifteen(monkeypatch)

    anchor = service.get_anchor(1)

    assert (anchor["anchor_pct"], anchor["mechanic_label"]) == (20.0, "20% Off")
    assert [(item["effective_from"], item["anchor_pct"], item["source"]) for item in anchor["upcoming"]] == [
        ("2027-05-01", 15.0, "projected"),
    ]


def test_once_its_month_arrives_the_later_change_is_the_anchor(monkeypatch):
    _twenty_then_fifteen(monkeypatch, month=MAY_2027)

    anchor = service.get_anchor(1)

    assert (anchor["anchor_pct"], anchor["source"], anchor["effective_from"]) == (15.0, "projected", "2027-05-01")
    assert anchor["upcoming"] == []


def test_a_range_with_nothing_saved_follows_its_customers_later_change(monkeypatch):
    _twenty_then_fifteen(monkeypatch)

    pants = service.get_anchor(1)["ranges"][0]

    assert (pants["anchor_pct"], pants["source"]) == (20.0, "customer")
    assert [(item["effective_from"], item["anchor_pct"], item["source"]) for item in pants["upcoming"]] == [
        ("2027-05-01", 15.0, "customer"),
    ]


def test_an_overwrite_made_now_applies_from_this_month_and_keeps_the_later_change(monkeypatch):
    db = _twenty_then_fifteen(monkeypatch)
    db.moment_mechanics.append((1, "SKU-L", "pct_off_30"))

    anchor = service.overwrite_anchor(1, "pct_off_30")["anchor"]

    assert db.anchors[-1]["effective_from"] == NOV_2026
    assert (anchor["anchor_pct"], anchor["source"]) == (30.0, "manual")
    assert [(item["effective_from"], item["anchor_pct"]) for item in anchor["upcoming"]] == [("2027-05-01", 15.0)]


def test_a_later_save_for_the_same_month_replaces_the_change(monkeypatch):
    db = _twenty_then_fifteen(monkeypatch)
    db.add_anchor(1, "10", "manual", effective_from=MAY_2027)

    upcoming = service.get_anchor(1)["upcoming"]

    assert [(item["effective_from"], item["anchor_pct"], item["source"]) for item in upcoming] == [
        ("2027-05-01", 10.0, "manual"),
    ]


def test_anchor_history_marks_the_version_in_effect_and_the_ones_to_come(monkeypatch):
    _twenty_then_fifteen(monkeypatch)

    history = service.anchor_history(1)

    assert [(row["anchor_pct"], row["effective_from"], row["is_current"], row["is_upcoming"]) for row in history] == [
        (15.0, "2027-05-01", False, True),
        (20.0, None, True, False),
    ]


def test_anchor_writes_for_an_unknown_customer_are_404s(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        service.overwrite_anchor(9, "pct_off_30")
    with pytest.raises(common.CustomerNotFoundError):
        service.get_anchor(9)


# ---- resolve_uplifts ---------------------------------------------------------------


def test_placeholder_uplifts_follow_the_customers_anchor(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "30", "manual")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert _uplift_of(result, "pct_off_30") == 0.0
    assert _uplift_of(result, "pct_off_20") == -4.0
    assert _uplift_of(result, "b1g1") == 8.0
    # The voucher is not a discount, so the anchor never moves it.
    assert _uplift_of(result, "voucher") == 3.0
    assert result["anchor"]["anchor_pct"] == 30.0


def test_placeholders_use_the_products_range_anchor(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.skus["Aire Tape M"] = {"sku": "SKU-TM", "sku_range": "Tape"}
    db.add_anchor(1, "30", "manual", sku_range="Pants")
    _install(monkeypatch, db)

    assert _uplift_of(service.resolve_uplifts("fairprice", "Aire Pants L"), "pct_off_30") == 0.0
    assert _uplift_of(service.resolve_uplifts("fairprice", "Aire Tape M"), "pct_off_30") == 4.0
    # All SKUs: the customer's anchor, with Pants listed as differing.
    all_skus = service.resolve_uplifts("fairprice")
    assert _uplift_of(all_skus, "pct_off_30") == 4.0
    assert all_skus["product_uplifts"]["Aire Pants L"]["pct_off_30"] == 0.0
    assert "Aire Tape M" not in all_skus["product_uplifts"]
    assert all_skus["product_anchors"] == {"Aire Pants L": 30.0}


def test_a_typed_estimate_does_not_follow_the_anchor(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_anchor(1, "30", "manual")
    db.add_uplift("b1g1", "Buy 1 Get 1 Free", "50", "15", scope="customer", customer_id=1, source="estimate")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert _uplift_of(result, "b1g1") == 15.0


def test_the_most_specific_scope_wins(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_uplift("pct_off_30", "30% Off", "30", "6", scope="customer", customer_id=1, source="estimate")
    db.add_uplift("pct_off_30", "30% Off", "30", "7", scope="range", customer_id=1, sku_range="Pants", source="estimate")
    db.add_uplift("pct_off_30", "30% Off", "30", "9", scope="customer", customer_id=2, source="estimate")
    _install(monkeypatch, db)

    assert _uplift_of(service.resolve_uplifts("fairprice", sku_range="Pants"), "pct_off_30") == 7.0
    assert _uplift_of(service.resolve_uplifts("fairprice", "Aire Pants L"), "pct_off_30") == 7.0
    assert _uplift_of(service.resolve_uplifts("fairprice", "Unknown product"), "pct_off_30") == 6.0
    assert _uplift_of(service.resolve_uplifts("fairprice"), "pct_off_30") == 6.0
    assert _uplift_of(service.resolve_uplifts("giant"), "pct_off_30") == 9.0


def test_a_sku_level_value_saved_before_ranges_no_longer_applies(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_uplift("pct_off_30", "30% Off", "30", "7", scope="range", customer_id=1, sku_range="Pants", source="estimate")
    db.add_uplift("pct_off_30", "30% Off", "30", "8", scope="sku", customer_id=1, sku="SKU-L", source="estimate")
    _install(monkeypatch, db)

    # The product's range value, not its old SKU-level 8.
    assert _uplift_of(service.resolve_uplifts("fairprice", "Aire Pants L"), "pct_off_30") == 7.0


def test_all_skus_lists_only_the_products_whose_value_differs(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.skus["Aire Pants XL"] = {"sku": "SKU-XL", "sku_range": "Pants"}
    db.skus["Aire Tape M"] = {"sku": "SKU-TM", "sku_range": "Tape"}
    db.add_uplift("pct_off_30", "30% Off", "30", "7", scope="range", customer_id=1, sku_range="Pants", source="estimate")
    db.add_uplift("b1g1", "Buy 1 Get 1 Free", "50", "15", scope="sku", customer_id=1, sku="SKU-L", source="estimate")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert _uplift_of(result, "pct_off_30") == 4.0
    # Every SKU of a range follows the range; the old SKU-level b1g1 is ignored.
    assert result["product_uplifts"] == {
        "Aire Pants L": {"pct_off_30": 7.0},
        "Aire Pants XL": {"pct_off_30": 7.0},
    }


def test_all_skus_lists_the_ranges_whose_value_differs(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.skus["Aire Tape M"] = {"sku": "SKU-TM", "sku_range": "Tape"}
    db.add_uplift("pct_off_30", "30% Off", "30", "7", scope="range", customer_id=1, sku_range="Pants", source="estimate")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert result["range_uplifts"] == {"Pants": {"pct_off_30": 7.0}}
    assert result["product_ranges"]["Aire Tape M"] == "Tape"


def test_all_skus_lists_no_products_when_none_differ(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    assert service.resolve_uplifts("fairprice")["product_uplifts"] == {}


def test_resolving_for_an_unknown_customer_is_a_404(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        service.resolve_uplifts("nobody")


# ---- mechanic discounts --------------------------------------------------------


def test_a_discount_edit_is_a_new_version_of_the_mechanic_and_keeps_the_old_one(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    old = db.current_uplifts("pct_off_30")[0]

    result = service.set_mechanic_discount("pct_off_30", Decimal("25"), note="Now 25% off")

    assert result["changed"] is True
    assert (result["setting"]["effective_discount_pct"], result["setting"]["scope"]) == (25.0, "all")
    assert [row["id"] for row in db.current_uplifts("pct_off_30")] == [result["setting"]["id"]]
    assert next(r for r in db.uplifts if r["uplift_id"] == old["id"])["effective_discount_pct"] == Decimal("30")


def test_saving_the_same_discount_writes_nothing(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    count = len(db.uplifts)

    assert service.set_mechanic_discount("pct_off_30", Decimal("30.00"))["changed"] is False
    assert len(db.uplifts) == count


def test_a_discount_for_an_unknown_mechanic_is_not_found(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(service.MechanicNotFoundError):
        service.set_mechanic_discount("pct_off_99", Decimal("10"))


# ---- listing, matching, history ----------------------------------------------------


def test_unmapped_mechanics_lists_labels_no_setting_matches(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_promotion(1, date(2026, 7, 1), date(2026, 7, 31), "30% Off")
    db.add_promotion(1, date(2026, 7, 1), date(2026, 7, 31), "Free tote bag")
    db.add_promotion(1, date(2026, 8, 1), date(2026, 8, 31), "Buy 2 Get 1 Free")
    _install(monkeypatch, db)

    result = service.list_settings()

    # "Buy 2 Get 1 Free" reads fine but has no row in this fake's seed.
    assert [row["promotion_mechanic"] for row in result["unmapped_mechanics"]] == [
        "Buy 2 Get 1 Free",
        "Free tote bag",
    ]
    assert result["default_anchor_pct"] == 20.0
    assert len(result["settings"]) == len(SEED)


def test_match_reads_the_label_by_its_pattern(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    matched = service.match_mechanic("30 % off")
    unmatched = service.match_mechanic("Free tote bag")

    assert (matched["mechanic_key"], matched["matched"]) == ("pct_off_30", True)
    assert matched["setting"]["uplift_pct"] == 4.0
    assert (unmatched["mechanic_key"], unmatched["matched"], unmatched["setting"]) == (None, False, None)


def test_mechanic_history_is_newest_first_and_unknown_is_not_found(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    service.set_mechanic_discount("pct_off_30", Decimal("25"))

    history = service.mechanic_history("pct_off_30")

    assert [row["effective_discount_pct"] for row in history] == [25.0, 30.0]
    with pytest.raises(service.MechanicNotFoundError):
        service.mechanic_history("pct_off_99")
