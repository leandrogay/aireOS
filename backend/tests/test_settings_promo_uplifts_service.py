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
    answering the statements the service sends. Superseding is the only
    UPDATE allowed; any other UPDATE or a DELETE fails the test.
    """

    def __init__(self):
        self.customers = {1: "fairprice", 2: "giant"}
        self.skus = {"Aire Pants L": {"sku": "SKU-L", "sku_range": "Pants"}}
        self.promotions = []
        self.uplifts = []
        self.anchors = []
        self.rules = []
        self.add_rule("0.4", "seed")
        for key, label, discount, uplift in SEED:
            self.add_uplift(key, label, discount, uplift, changed_by="seed")
        self.add_anchor(None, "20", "manual", "seed")

    # ---- helpers for tests -----------------------------------------------------

    def _next(self, rows):
        return len(rows) + 1

    def add_uplift(self, key, label, discount, uplift, scope="all", customer_id=None,
                   sku_range=None, sku=None, source="rule_based", changed_by="aireos", note=None):
        row = {
            "id": self._next(self.uplifts),
            "mechanic_key": key,
            "mechanic_label": label,
            "effective_discount_pct": Decimal(discount) if discount is not None else None,
            "scope": scope,
            "customer_id": customer_id,
            "sku_range": sku_range,
            "sku": sku,
            "uplift_pct": Decimal(uplift),
            "source": source,
            "evidence_months": None,
            "note": note,
            "changed_by": changed_by,
            "changed_at": STAMP + timedelta(minutes=len(self.uplifts)),
            "superseded_at": None,
        }
        self.uplifts.append(row)
        return row

    def add_rule(self, rate, changed_by="aireos"):
        row = {
            "id": self._next(self.rules),
            "uplift_per_point_pct": Decimal(str(rate)),
            "changed_by": changed_by,
            "changed_at": STAMP + timedelta(minutes=len(self.rules)),
            "superseded_at": None,
        }
        self.rules.append(row)
        return row

    def current_rule(self):
        return next((r for r in self.rules if r["superseded_at"] is None), None)

    def add_anchor(self, customer_id, anchor_pct, source, changed_by="aireos"):
        row = {
            "id": self._next(self.anchors),
            "customer_id": customer_id,
            "anchor_pct": Decimal(anchor_pct) if anchor_pct is not None else None,
            "source": source,
            "changed_by": changed_by,
            "changed_at": STAMP + timedelta(minutes=len(self.anchors)),
            "superseded_at": None,
        }
        self.anchors.append(row)
        return row

    def add_promotion(self, customer_id, start, end, mechanic, promo_type="monthly"):
        self.promotions.append({
            "customer_id": customer_id,
            "promotion_id": len(self.promotions) + 1,
            "period_start": start,
            "period_end": end,
            "promo_type": promo_type,
            "promotion_mechanic": mechanic,
        })

    def current_uplifts(self, key=None):
        return [r for r in self.uplifts if r["superseded_at"] is None and (key is None or r["mechanic_key"] == key)]

    def _with_name(self, row):
        return {**row, "customer_name": self.customers.get(row["customer_id"])}

    # ---- statements --------------------------------------------------------------

    def respond(self, sql, params):
        params = params or {}

        if sql.startswith("DELETE") or (sql.startswith("UPDATE") and "superseded_at = now()" not in sql):
            raise AssertionError(f"settings tables are append-only: {sql}")

        if sql.startswith("UPDATE promo_rule_settings"):
            for row in self.rules:
                if row["superseded_at"] is None:
                    row["superseded_at"] = STAMP + timedelta(days=1)
            return []

        if sql.startswith("INSERT INTO promo_rule_settings"):
            self.add_rule(params["uplift_per_point_pct"], params["changed_by"])
            return []

        if "FROM promo_rule_settings WHERE superseded_at IS NULL" in sql:
            current = self.current_rule()
            return [dict(current)] if current else []

        if "FROM promo_rule_settings ORDER BY" in sql:
            return sorted((dict(r) for r in self.rules), key=lambda r: (r["changed_at"], r["id"]), reverse=True)

        if sql.startswith("UPDATE promo_uplift_settings"):
            for row in self.uplifts:
                if row["id"] == params["setting_id"] and row["superseded_at"] is None:
                    row["superseded_at"] = STAMP + timedelta(days=1)
            return []

        if sql.startswith("UPDATE promo_anchor_settings"):
            for row in self.anchors:
                if row["customer_id"] == params["customer_id"] and row["superseded_at"] is None:
                    row["superseded_at"] = STAMP + timedelta(days=1)
            return []

        if sql.startswith("INSERT INTO promo_uplift_settings"):
            row = self.add_uplift(
                params["mechanic_key"], params["mechanic_label"], params["effective_discount_pct"],
                params["uplift_pct"], params["scope"], params["customer_id"], params["sku_range"],
                params["sku"], params["source"], params["changed_by"], params["note"],
            )
            row["kind"] = params.get("kind")
            row["archived_at"] = params.get("archived_at")
            row["evidence_months"] = params.get("evidence_months")
            return [(row["id"],)]

        if sql.startswith("INSERT INTO promo_anchor_settings"):
            self.add_anchor(params["customer_id"], params["anchor_pct"], params["source"], params["changed_by"])
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

        if "FROM effective_sellout es JOIN customer_retailers" in sql:
            # No sell-out in these tests: every store counts the same.
            return []

        if "FROM promotions p JOIN promotion_stores" in sql:
            wanted = params.get("customer_id")
            return [p for p in self.promotions if wanted is None or p["customer_id"] == wanted]

        if "FROM promotions WHERE promotion_mechanic IS NOT NULL" in sql:
            counts = {}
            for p in self.promotions:
                counts[p["promotion_mechanic"]] = counts.get(p["promotion_mechanic"], 0) + 1
            return [{"promotion_mechanic": m, "promotions": n} for m, n in counts.items()]

        if "FROM skus" in sql and "sku IS DISTINCT FROM sku_range" in sql:
            return [{"product_name": name, **row} for name, row in self.skus.items()]

        if "FROM skus" in sql:
            row = self.skus.get(params["product_name"])
            return [row] if row else []

        if "FROM promo_anchor_settings WHERE superseded_at IS NULL" in sql:
            return [dict(r) for r in self.anchors if r["superseded_at"] is None]

        if "FROM promo_anchor_settings WHERE customer_id = :customer_id" in sql:
            rows = [r for r in self.anchors if r["customer_id"] == params["customer_id"]]
            return sorted(rows, key=lambda r: (r["changed_at"], r["id"]), reverse=True)

        if "source = 'rule_based'" in sql and "mechanic_key = :mechanic_key" in sql:
            rows = [r for r in self.uplifts
                    if r["mechanic_key"] == params["mechanic_key"] and r["scope"] == "all" and r["source"] == "rule_based"]
            rows.sort(key=lambda r: (r["changed_at"], r["id"]), reverse=True)
            return [(r["uplift_pct"],) for r in rows[:1]]

        if "FROM promo_uplift_settings s" in sql and "s.id = :setting_id" in sql:
            return [self._with_name(r) for r in self.uplifts if r["id"] == params["setting_id"]]

        if "FROM promo_uplift_settings s" in sql and "s.mechanic_key = :mechanic_key" in sql:
            rows = [self._with_name(r) for r in self.uplifts if r["mechanic_key"] == params["mechanic_key"]]
            return sorted(rows, key=lambda r: (r["changed_at"], r["id"]), reverse=True)

        if "FROM promo_uplift_settings s" in sql and "s.superseded_at IS NULL" in sql:
            return [self._with_name(r) for r in self.current_uplifts()]

        raise AssertionError(f"unexpected statement: {sql}")


TODAY = date(2026, 10, 28)


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    monkeypatch.setattr(service, "_utc_today", lambda: TODAY)
    return conn


def _uplift_of(result, key):
    return next(u["uplift_pct"] for u in result["uplifts"] if u["mechanic_key"] == key)


# ---- anchor ----------------------------------------------------------------------


def test_a_customer_with_no_promotions_uses_the_all_customers_anchor(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    anchor = service.get_anchor(1)

    assert anchor["anchor_pct"] == 20.0
    assert anchor["source"] == "default"
    assert anchor["suggested"] is None


def test_the_anchor_is_suggested_from_the_customers_own_promotions(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_promotion(1, date(2026, 7, 1), date(2026, 7, 31), "30% Off")
    db.add_promotion(1, date(2026, 8, 1), date(2026, 8, 31), "30% Off")
    db.add_promotion(2, date(2026, 8, 1), date(2026, 8, 31), "20% Off")
    _install(monkeypatch, db)

    anchor = service.get_anchor(1)

    assert anchor["anchor_pct"] == 30.0
    assert anchor["source"] == "suggested"
    assert anchor["suggested"]["months_used"] == 2


def test_a_manual_anchor_beats_the_suggestion_and_reset_brings_it_back(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_promotion(1, date(2026, 7, 1), date(2026, 7, 31), "30% Off")
    _install(monkeypatch, db)

    saved = service.set_anchor(1, Decimal("25"))
    assert saved["changed"] is True
    assert saved["anchor"]["anchor_pct"] == 25.0
    assert saved["anchor"]["source"] == "manual"
    assert saved["anchor"]["changed_by"] == "aireos"

    reset = service.reset_anchor(1)
    assert reset["changed"] is True
    assert reset["anchor"]["anchor_pct"] == 30.0
    assert reset["anchor"]["source"] == "suggested"

    # The manual version stays in the history; nothing was deleted.
    history = service.anchor_history(1)
    assert [row["source"] for row in history] == ["suggested", "manual"]
    assert [row["is_current"] for row in history] == [True, False]


def test_saving_the_same_manual_anchor_twice_writes_one_version(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    service.set_anchor(1, Decimal("25"))
    second = service.set_anchor(1, Decimal("25.00"))

    assert second["changed"] is False
    assert len([r for r in db.anchors if r["customer_id"] == 1]) == 1


def test_resetting_an_anchor_that_was_never_set_writes_nothing(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    assert service.reset_anchor(1)["changed"] is False
    assert len(db.anchors) == 1


def test_changing_the_all_customers_anchor_moves_customers_without_data(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    result = service.set_anchor(None, Decimal("30"))

    assert result == {"changed": True, "default_anchor_pct": 30.0}
    assert service.get_anchor(2)["anchor_pct"] == 30.0


def test_anchor_writes_for_an_unknown_customer_are_404s(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        service.set_anchor(9, Decimal("25"))
    with pytest.raises(common.CustomerNotFoundError):
        service.get_anchor(9)


# ---- resolve_uplifts ---------------------------------------------------------------


def test_rule_based_uplifts_follow_the_customers_anchor(monkeypatch):
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
    db.add_uplift("pct_off_30", "30% Off", "30", "8", scope="sku", customer_id=1, sku="SKU-L", source="estimate")
    db.add_uplift("pct_off_30", "30% Off", "30", "9", scope="customer", customer_id=2, source="estimate")
    _install(monkeypatch, db)

    assert _uplift_of(service.resolve_uplifts("fairprice", "Aire Pants L"), "pct_off_30") == 8.0
    assert _uplift_of(service.resolve_uplifts("fairprice", "Unknown product"), "pct_off_30") == 6.0
    assert _uplift_of(service.resolve_uplifts("fairprice"), "pct_off_30") == 6.0
    assert _uplift_of(service.resolve_uplifts("giant"), "pct_off_30") == 9.0


def test_all_skus_lists_only_the_products_whose_value_differs(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.skus["Aire Pants XL"] = {"sku": "SKU-XL", "sku_range": "Pants"}
    db.skus["Aire Tape M"] = {"sku": "SKU-TM", "sku_range": "Tape"}
    db.add_uplift("pct_off_30", "30% Off", "30", "7", scope="range", customer_id=1, sku_range="Pants", source="estimate")
    db.add_uplift("b1g1", "Buy 1 Get 1 Free", "50", "15", scope="sku", customer_id=1, sku="SKU-L", source="estimate")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert _uplift_of(result, "pct_off_30") == 4.0
    assert result["product_uplifts"] == {
        "Aire Pants L": {"pct_off_30": 7.0, "b1g1": 15.0},
        "Aire Pants XL": {"pct_off_30": 7.0},
    }


def test_all_skus_skips_the_product_lookup_when_nothing_is_set_per_product(monkeypatch):
    conn = _install(monkeypatch, FakePromoUpliftDatabase())

    result = service.resolve_uplifts("fairprice")

    assert result["product_uplifts"] == {}
    assert conn.sql_containing("FROM skus") == []


def test_resolving_for_an_unknown_customer_is_a_404(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        service.resolve_uplifts("nobody")


# ---- editing uplifts ---------------------------------------------------------------


def test_editing_a_value_supersedes_the_row_and_inserts_an_estimate(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    old = db.current_uplifts("pct_off_30")[0]

    result = service.update_uplift(old["id"], Decimal("6"), note="Fairprice data")

    assert result["changed"] is True
    assert result["setting"]["uplift_pct"] == 6.0
    assert result["setting"]["source"] == "estimate"
    assert result["setting"]["follows_rule"] is False
    assert result["setting"]["changed_by"] == "aireos"
    assert old["superseded_at"] is not None
    assert old["uplift_pct"] == Decimal("4")
    assert len(db.current_uplifts("pct_off_30")) == 1


def test_saving_the_same_estimate_twice_writes_one_version(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    first = service.update_uplift(db.current_uplifts("pct_off_30")[0]["id"], Decimal("6"))

    second = service.update_uplift(first["setting"]["id"], Decimal("6.00"))

    assert second["changed"] is False
    assert len([r for r in db.uplifts if r["mechanic_key"] == "pct_off_30"]) == 2


def test_learned_values_cannot_be_edited_or_reset(monkeypatch):
    db = FakePromoUpliftDatabase()
    learned = db.add_uplift("pct_off_30", "30% Off", "30", "8", scope="sku", customer_id=1, sku="SKU-L", source="learned")
    _install(monkeypatch, db)

    with pytest.raises(service.UpliftSettingConflictError):
        service.update_uplift(learned["id"], Decimal("5"))
    with pytest.raises(service.UpliftSettingConflictError):
        service.reset_uplift(learned["id"])


def test_editing_an_old_version_is_a_conflict(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    old_id = db.current_uplifts("pct_off_30")[0]["id"]
    service.update_uplift(old_id, Decimal("6"))

    with pytest.raises(service.UpliftSettingConflictError):
        service.update_uplift(old_id, Decimal("7"))


def test_editing_a_missing_row_is_not_found(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(service.UpliftSettingNotFoundError):
        service.update_uplift(999, Decimal("5"))


def test_reset_puts_an_all_customers_value_back_on_the_rule_based_uplift_rule(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    edited = service.update_uplift(db.current_uplifts("pct_off_30")[0]["id"], Decimal("9"))

    result = service.reset_uplift(edited["setting"]["id"])

    assert result["changed"] is True
    assert result["setting"]["source"] == "rule_based"
    assert result["setting"]["follows_rule"] is True
    assert result["setting"]["uplift_pct"] == 4.0


def test_reset_gives_the_voucher_back_its_rule_based_uplift_value(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    edited = service.update_uplift(db.current_uplifts("voucher")[0]["id"], Decimal("5"))

    result = service.reset_uplift(edited["setting"]["id"])

    assert result["setting"]["uplift_pct"] == 3.0


def test_reset_retires_a_customer_override_so_the_broader_value_applies(monkeypatch):
    db = FakePromoUpliftDatabase()
    override = db.add_uplift("pct_off_30", "30% Off", "30", "9", scope="customer", customer_id=1, source="estimate")
    _install(monkeypatch, db)

    result = service.reset_uplift(override["id"])

    assert result == {"changed": True, "setting": None}
    assert _uplift_of(service.resolve_uplifts("fairprice"), "pct_off_30") == 4.0


def test_resetting_a_rule_based_uplift_writes_nothing(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    count = len(db.uplifts)

    assert service.reset_uplift(db.current_uplifts("pct_off_30")[0]["id"])["changed"] is False
    assert len(db.uplifts) == count


# ---- overrides ---------------------------------------------------------------------


def test_an_override_copies_the_mechanic_and_is_an_estimate(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    result = service.add_override("pct_off_30", "sku", 1, Decimal("7"), sku="SKU-L")

    setting = result["setting"]
    assert (setting["scope"], setting["sku"], setting["customer_name"]) == ("sku", "SKU-L", "fairprice")
    assert (setting["mechanic_label"], setting["effective_discount_pct"]) == ("30% Off", 30.0)
    assert setting["source"] == "estimate"


def test_a_second_override_at_the_same_scope_is_a_conflict(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    service.add_override("pct_off_30", "customer", 1, Decimal("7"))

    with pytest.raises(service.UpliftSettingConflictError):
        service.add_override("pct_off_30", "customer", 1, Decimal("8"))


def test_an_override_needs_a_known_mechanic_and_customer(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(service.MechanicNotFoundError):
        service.add_override("pct_off_99", "customer", 1, Decimal("7"))
    with pytest.raises(common.CustomerNotFoundError):
        service.add_override("pct_off_30", "customer", 9, Decimal("7"))


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
    service.update_uplift(db.current_uplifts("pct_off_30")[0]["id"], Decimal("6"))

    history = service.mechanic_history("pct_off_30")

    assert [row["source"] for row in history] == ["estimate", "rule_based"]
    with pytest.raises(service.MechanicNotFoundError):
        service.mechanic_history("pct_off_99")


# ---- anchor: past months only ------------------------------------------------------


def test_planned_promotions_do_not_shape_the_anchor(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_promotion(1, date(2026, 8, 1), date(2026, 8, 31), "20% Off")
    db.add_promotion(1, date(2026, 11, 1), date(2026, 11, 30), "50% Off")  # after TODAY's month
    db.add_uplift("pct_off_50", "50% Off", "50", "12")
    _install(monkeypatch, db)

    anchor = service.get_anchor(1)

    assert anchor["anchor_pct"] == 20.0
    assert anchor["suggested"]["last_month"] == "2026-08-01"


# ---- archive, restore, add mechanic -----------------------------------------------------


def test_archive_and_restore_are_new_versions_and_archived_values_are_not_offered(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    row_id = db.current_uplifts("pct_off_30")[0]["id"]

    archived = service.archive_uplift(row_id)
    resolved = service.resolve_uplifts("fairprice")

    assert archived["changed"] is True
    assert archived["setting"]["archived_at"] is not None
    assert "pct_off_30" not in {u["mechanic_key"] for u in resolved["uplifts"]}

    again = service.archive_uplift(archived["setting"]["id"])
    assert again["changed"] is False

    restored = service.restore_uplift(archived["setting"]["id"])
    assert restored["setting"]["archived_at"] is None
    assert len([r for r in db.uplifts if r["mechanic_key"] == "pct_off_30"]) == 3


def test_an_archived_value_cannot_be_edited(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    archived = service.archive_uplift(db.current_uplifts("pct_off_30")[0]["id"])

    with pytest.raises(service.UpliftSettingConflictError):
        service.update_uplift(archived["setting"]["id"], Decimal("9"))


def test_a_new_mechanic_reads_its_key_and_discount_from_the_label(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    result = service.add_mechanic("promotion", "Buy 3 Get 1 Free")

    assert result["setting"]["mechanic_key"] == "b3g1"
    assert result["setting"]["effective_discount_pct"] == 25.0
    assert result["setting"]["source"] == "rule_based"


def test_a_mechanic_with_a_typed_uplift_is_an_estimate_and_duplicates_conflict(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    result = service.add_mechanic("promotion", "35% Off", uplift_pct=Decimal("7"))
    assert result["setting"]["source"] == "estimate"

    with pytest.raises(service.UpliftSettingConflictError):
        service.add_mechanic("promotion", "35 % OFF")


def test_an_unreadable_mechanic_label_is_refused(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(ValueError):
        service.add_mechanic("promotion", "Free tote bag")


def test_a_voucher_needs_a_discount_or_an_uplift(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    with pytest.raises(ValueError):
        service.add_mechanic("voucher", "$5 off $50")

    result = service.add_mechanic("voucher", "$5 off $50", uplift_pct=Decimal("2"))
    assert result["setting"]["mechanic_key"] == "voucher_5_off_50"
    assert result["setting"]["kind"] == "voucher"


# ---- per-product sources ---------------------------------------------------------------


def test_all_skus_reports_where_each_products_own_value_came_from(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_uplift("pct_off_30", "30% Off", "30", "6", scope="sku", customer_id=1, sku="SKU-L", source="measured")
    _install(monkeypatch, db)

    result = service.resolve_uplifts("fairprice")

    assert result["product_uplifts"]["Aire Pants L"]["pct_off_30"] == 6.0
    assert result["product_sources"]["Aire Pants L"]["pct_off_30"]["source"] == "measured"


# ---- the editable rate -------------------------------------------------------------


def test_a_rate_change_moves_rule_based_uplifts_only(monkeypatch):
    db = FakePromoUpliftDatabase()
    db.add_uplift("pct_off_30", "30% Off", "30", "9", scope="customer", customer_id=2, source="estimate")
    db.add_uplift("pct_off_50", "50% Off", "50", "14", scope="customer", customer_id=1, source="measured")
    _install(monkeypatch, db)

    before = service.resolve_uplifts("fairprice")
    service.set_rule(Decimal("0.6"))
    after = service.resolve_uplifts("fairprice")
    giant = service.resolve_uplifts("giant")

    # Rule-based: 30% Off at the 20% anchor, 10 points deeper: 0.4 -> +4, 0.6 -> +6.
    assert _uplift_of(before, "pct_off_30") == 4.0
    assert _uplift_of(after, "pct_off_30") == 6.0
    assert _uplift_of(after, "pct_off_50") == 14.0     # measured: unchanged
    assert _uplift_of(giant, "pct_off_30") == 9.0      # estimate: unchanged
    assert _uplift_of(after, "voucher") == 3.0         # the voucher never follows the rule


def test_a_high_rate_saves_with_a_warning_and_caps_rule_based_uplifts(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    saved = service.set_rule(Decimal("4"))
    assert saved["changed"] is True
    assert saved["warning"] is not None

    service.set_rule(Decimal("20"))
    b1g1 = next(u for u in service.resolve_uplifts("fairprice")["uplifts"] if u["mechanic_key"] == "b1g1")
    assert b1g1["uplift_pct"] == 300.0
    assert b1g1["capped"] is True


def test_saving_the_same_rate_writes_nothing_and_reset_goes_back_to_0_4(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)

    assert service.set_rule(Decimal("0.4"))["changed"] is False
    service.set_rule(Decimal("0.6"))
    reset = service.reset_rule()

    assert reset["changed"] is True
    assert reset["rule"]["uplift_per_point_pct"] == 0.4
    assert reset["rule"]["is_default"] is True
    history = service.get_rule()["history"]
    assert [h["uplift_per_point_pct"] for h in history] == [0.4, 0.6, 0.4]


def test_a_rate_of_zero_or_less_is_refused(monkeypatch):
    _install(monkeypatch, FakePromoUpliftDatabase())

    with pytest.raises(ValueError):
        service.set_rule(Decimal("0"))


def test_new_rule_based_rows_are_stored_under_the_current_rate(monkeypatch):
    db = FakePromoUpliftDatabase()
    _install(monkeypatch, db)
    service.set_rule(Decimal("0.6"))

    result = service.add_mechanic("promotion", "35% Off")

    # Stored as a reference at the 20% anchor: 15 points deeper x 0.6 = +9.
    assert result["setting"]["uplift_pct"] == 9.0
    assert result["setting"]["source"] == "rule_based"
