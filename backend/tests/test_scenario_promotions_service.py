import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

pytestmark = pytest.mark.usefixtures("migrated_budget_schema")
from conftest import FakeConnection, FakeEngine

from app.services.scenario import common
from app.services.scenario import promotions as promotions_service


STAMP = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)

CUSTOMERS = {"fairprice": 1}

SKUS = [{"sku": "SKU-A", "product_name": "Comfort Pants M", "is_active": True}]


def _answer_ranges_and_customers(sql, params):
    if "ANY(:sku_ranges)" in sql:
        return [("Ultra Tape",)]
    if "FROM customers" in sql:
        return [{"customer_id": CUSTOMERS[name], "customer_name": name} for name in params["customer_names"] if name in CUSTOMERS]
    return []


def test_a_range_promotion_resolves_and_stores_its_range(monkeypatch):
    conn = FakeConnection(
        _answer_ranges_and_customers
    )
    monkeypatch.setattr(promotions_service.common, "get_engine", lambda: FakeEngine(conn))

    params = promotions_service._write_params(conn, _promotion(sku_ranges=["Ultra Tape"], product_name=None))

    assert params["sku_ranges"] == ["Ultra Tape"]
    assert params["sku"] is None


def _promotion(**changes):
    promotion = {
        "customer_names": ["fairprice"],
        "sku_ranges": None,
        "excluded_pairs": [],
        "references_by_customer": {},
        "product_name": "Comfort Pants M",
        "promo_type": "monthly",
        "mechanic_key": "pct_off_30",
        "mechanic_label": "30% Off",
        "reference_uplift_pct": Decimal("4"),
        "reference_source": "placeholder",
        "reference_by_sku": {"Comfort Pants M": Decimal("6")},
        "override_uplift_pct": None,
        "voucher": True,
        "voucher_uplift_pct": Decimal("3"),
        "voucher_by_sku": {},
        "explanation": None,
        "start_month": date(2026, 11, 1),
        "end_month": date(2026, 12, 1),
        "start_date": None,
        "end_date": None,
        "is_active": True,
    }
    promotion.update(changes)
    return promotion


class FakePromotionsDatabase:
    """
    In-memory customers + skus + scenario_promotions, answering the
    statements the service sends. The real SQL is only proven against
    Postgres.
    """

    def __init__(self):
        self.promotions = {}
        self.next_id = 1

    def _view_row(self, promotion_id):
        stored = self.promotions[promotion_id]
        product_name = next((row["product_name"] for row in SKUS if row["sku"] == stored["sku"]), None)
        hidden = ("customer_id", "customer_ids", "excluded_pairs", "references_by_customer")
        row = {key: value for key, value in stored.items() if key not in hidden}
        names = {cid: name for name, cid in CUSTOMERS.items()}
        # As the SELECT: ids named back.
        return {
            **row,
            "promotion_id": promotion_id,
            "customer_names": sorted(names[cid] for cid in stored["customer_ids"] or []),
            "excluded_pairs": [
                {"customer_name": names[pair["customer_id"]], "sku_range": pair["sku_range"]}
                for pair in json.loads(stored["excluded_pairs"])
            ],
            "references_by_customer": {
                names[int(cid)]: values for cid, values in json.loads(stored["references_by_customer"]).items()
            },
            "product_name": product_name,
            # Postgres hands JSONB back already parsed.
            "reference_by_sku": json.loads(stored["reference_by_sku"]),
            "voucher_by_sku": json.loads(stored["voucher_by_sku"]),
            "created_at": STAMP,
            "updated_at": STAMP,
        }

    def respond(self, sql, params):
        params = params or {}

        if "FROM customers" in sql and "customer_name = ANY(:customer_names)" in sql:
            return [
                {"customer_id": CUSTOMERS[name], "customer_name": name}
                for name in params["customer_names"]
                if name in CUSTOMERS
            ]

        if "FROM skus" in sql and "product_name = :product_name" in sql:
            return [
                {"sku": row["sku"], "is_active": row["is_active"]}
                for row in SKUS
                if row["product_name"] == params["product_name"]
            ]

        if sql.startswith("INSERT INTO scenario_promotions"):
            promotion_id = self.next_id
            self.next_id += 1
            self.promotions[promotion_id] = dict(params)
            return [(promotion_id,)]

        if sql.startswith("UPDATE scenario_promotions"):
            promotion_id = params["promotion_id"]
            if promotion_id not in self.promotions:
                return []
            self.promotions[promotion_id] = {k: v for k, v in params.items() if k != "promotion_id"}
            return [(promotion_id,)]

        if sql.startswith("DELETE FROM scenario_promotions"):
            promotion_id = params["promotion_id"]
            if promotion_id not in self.promotions:
                return []
            del self.promotions[promotion_id]
            return [(promotion_id,)]

        if "FROM scenario_promotions" in sql:
            ids = (
                [params["promotion_id"]]
                if "promotion_id = :promotion_id" in sql
                else sorted(self.promotions, reverse=True)
            )
            return [self._view_row(pid) for pid in ids if pid in self.promotions]

        return []


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


# ---- Create ------------------------------------------------------------------


def test_create_resolves_names_and_stores_per_sku_values_as_json(monkeypatch):
    conn = _install(monkeypatch, FakePromotionsDatabase())

    promotions_service.create_scenario_promotion(_promotion())

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert params["customer_id"] == 1
    assert params["sku"] == "SKU-A"
    assert json.loads(params["reference_by_sku"]) == {"Comfort Pants M": 6.0}
    assert json.loads(params["voucher_by_sku"]) == {}


def test_create_returns_the_promotion_with_the_uplifts_as_saved(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())

    saved = promotions_service.create_scenario_promotion(_promotion())

    assert saved["promotion_id"] == 1
    assert saved["customer_names"] == ["fairprice"]
    assert saved["sku"] == "SKU-A"
    assert saved["reference_uplift_pct"] == 4.0
    assert saved["reference_by_sku"] == {"Comfort Pants M": 6.0}
    assert saved["override_uplift_pct"] is None
    assert saved["voucher_uplift_pct"] == 3.0
    assert saved["start_month"] == "2026-11-01"
    assert saved["created_at"] == STAMP.isoformat()


def test_create_with_an_unknown_customer_raises_value_error(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())

    with pytest.raises(ValueError, match="Unknown customer"):
        promotions_service.create_scenario_promotion(_promotion(customer_names=["nobody"]))


def test_a_promotion_for_several_customers_keeps_each_ones_values_by_id(monkeypatch):
    CUSTOMERS["nhg"] = 4
    try:
        db = FakePromotionsDatabase()
        conn = _install(monkeypatch, db)
        references = {
            "fairprice": {"reference_uplift_pct": Decimal("4"), "reference_source": "measured",
                          "reference_by_sku": {}, "voucher_uplift_pct": Decimal("3"), "voucher_by_sku": {}},
            "nhg": {"reference_uplift_pct": Decimal("9"), "reference_source": "placeholder",
                    "reference_by_sku": {"Comfort Pants M": Decimal("12")}, "voucher_uplift_pct": Decimal("0"),
                    "voucher_by_sku": {}},
        }

        saved = promotions_service.create_scenario_promotion(
            _promotion(
                customer_names=["fairprice", "nhg"],
                references_by_customer=references,
                excluded_pairs=[{"customer_name": "nhg", "sku_range": None}],
            )
        )
    finally:
        del CUSTOMERS["nhg"]

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert params["customer_ids"] == [1, 4]
    assert params["customer_id"] is None
    assert json.loads(params["references_by_customer"])["4"]["reference_by_sku"] == {"Comfort Pants M": 12.0}
    assert json.loads(params["excluded_pairs"]) == [{"customer_id": 4, "sku_range": None}]
    assert saved["customer_names"] == ["fairprice", "nhg"]
    assert saved["references_by_customer"]["nhg"]["reference_uplift_pct"] == 9.0
    assert saved["excluded_pairs"] == [{"customer_name": "nhg", "sku_range": None}]


def test_copied_derivations_survive_saving_and_loading_without_changing_units(monkeypatch):
    db = FakePromotionsDatabase()
    conn = _install(monkeypatch, db)
    detail = {"product_name": "Comfort Pants M", "sku_range": "Pants", "uplift_pct": 6.0,
              "level": "placeholder", "lines": ["Anchor: 15% off.", "(30% - 15%) / 5 x 2 = +6%."]}
    references = {"fairprice": {"reference_uplift_pct": Decimal("4"), "reference_source": "placeholder",
                               "reference_by_sku": {"Comfort Pants M": Decimal("6")},
                               "voucher_uplift_pct": Decimal("3"), "voucher_by_sku": {},
                               "reference_details": [detail]}}

    saved = promotions_service.create_scenario_promotion(_promotion(references_by_customer=references))
    loaded = promotions_service.list_scenario_promotions()[0]

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert json.loads(params["references_by_customer"])["1"]["reference_details"] == [detail]
    assert saved["references_by_customer"]["fairprice"]["reference_details"] == [detail]
    assert loaded["references_by_customer"]["fairprice"]["reference_by_sku"] == {"Comfort Pants M": 6.0}
    assert loaded["references_by_customer"]["fairprice"]["reference_details"] == [detail]


def test_a_promotion_for_every_customer_is_stored_as_null(monkeypatch):
    db = FakePromotionsDatabase()
    conn = _install(monkeypatch, db)

    saved = promotions_service.create_scenario_promotion(_promotion(customer_names=None))

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert params["customer_ids"] is None
    assert saved["customer_names"] is None


# ---- Update and delete -------------------------------------------------------


def test_update_replaces_the_fields_including_the_override(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())
    promotions_service.create_scenario_promotion(_promotion())

    updated = promotions_service.update_scenario_promotion(
        1, _promotion(override_uplift_pct=Decimal("6.5"), is_active=False)
    )

    assert updated["override_uplift_pct"] == 6.5
    assert updated["is_active"] is False


def test_side_offer_dates_are_stored_and_returned_as_iso(monkeypatch):
    conn = _install(monkeypatch, FakePromotionsDatabase())

    saved = promotions_service.create_scenario_promotion(
        _promotion(promo_type="side_offer", start_date=date(2026, 11, 3), end_date=date(2026, 12, 9))
    )

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert params["start_date"] == date(2026, 11, 3)
    assert saved["start_date"] == "2026-11-03"
    assert saved["end_date"] == "2026-12-09"


def test_update_of_a_missing_promotion_returns_none(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())

    assert promotions_service.update_scenario_promotion(99, _promotion()) is None


def test_delete_removes_it_and_a_second_delete_returns_false(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())
    promotions_service.create_scenario_promotion(_promotion())

    assert promotions_service.delete_scenario_promotion(1) is True
    assert promotions_service.delete_scenario_promotion(1) is False
    assert promotions_service.list_scenario_promotions() == []


# ---- Migration ---------------------------------------------------------------


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def test_the_migrations_create_every_column_the_service_reads_and_writes():
    table = (MIGRATIONS / "018_create_scenario_promotions.sql").read_text().split(
        "CREATE TABLE IF NOT EXISTS scenario_promotions (", 1
    )[1]
    created = set(re.findall(r"^    ([a-z_]+) ", table, flags=re.MULTILINE)) - {"CONSTRAINT"}
    # Columns later migrations add (022 customer_ids, 023 excluded_pairs, 025 references_by_customer).
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        created |= set(
            re.findall(
                r"ALTER TABLE scenario_promotions\s+ADD COLUMN IF NOT EXISTS ([a-z_]+)", migration.read_text()
            )
        )
    read = set(re.findall(r"promotion\.([a-z_]+)", promotions_service._PROMOTION_SELECT))

    conn = FakeConnection(
        _answer_ranges_and_customers
    )
    written = promotions_service._write_params(conn, _promotion(sku_ranges=["Ultra Tape"], product_name=None))

    assert set(written) <= created
    assert read <= created
