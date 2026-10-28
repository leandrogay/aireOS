from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.scenario import common
from app.services.scenario import promotions as promotions_service


STAMP = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)

CUSTOMERS = {"fairprice": 1}

SKUS = [{"sku": "SKU-A", "product_name": "Comfort Pants M", "is_active": True}]


def _promotion(**changes):
    promotion = {
        "customer_name": "fairprice",
        "product_name": "Comfort Pants M",
        "promo_type": "monthly",
        "mechanic_key": "pct_off_30",
        "mechanic_label": "30% Off",
        "reference_uplift_pct": Decimal("4"),
        "reference_source": "rule_based",
        "override_uplift_pct": None,
        "voucher": True,
        "voucher_uplift_pct": Decimal("3"),
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
        row = {key: value for key, value in stored.items() if key != "customer_id"}
        return {
            **row,
            "promotion_id": promotion_id,
            "customer_name": "fairprice",
            "product_name": product_name,
            # Postgres hands JSONB back already parsed.
            "created_at": STAMP,
            "updated_at": STAMP,
        }

    def respond(self, sql, params):
        params = params or {}

        if "FROM customers" in sql and "customer_name = :customer_name" in sql:
            customer_id = CUSTOMERS.get(params["customer_name"])
            return [(customer_id,)] if customer_id else []

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


def test_create_resolves_the_customer_and_product_names(monkeypatch):
    conn = _install(monkeypatch, FakePromotionsDatabase())

    promotions_service.create_scenario_promotion(_promotion())

    (_, params), = conn.sql_containing("INSERT INTO scenario_promotions")
    assert params["customer_id"] == 1
    assert params["sku"] == "SKU-A"
    assert "reference_by_sku" not in params


def test_create_returns_the_promotion_with_the_uplifts_as_saved(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())

    saved = promotions_service.create_scenario_promotion(_promotion())

    assert saved["promotion_id"] == 1
    assert saved["customer_name"] == "fairprice"
    assert saved["sku"] == "SKU-A"
    assert saved["reference_uplift_pct"] == 4.0
    assert saved["override_uplift_pct"] is None
    assert saved["voucher_uplift_pct"] == 3.0
    assert saved["start_month"] == "2026-11-01"
    assert saved["created_at"] == STAMP.isoformat()


def test_create_with_an_unknown_customer_raises_value_error(monkeypatch):
    _install(monkeypatch, FakePromotionsDatabase())

    with pytest.raises(ValueError, match="Unknown customer"):
        promotions_service.create_scenario_promotion(_promotion(customer_name="nobody"))


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
