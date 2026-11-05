from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.routers import promotions
from app.services.promotion_pricing import (
    _price_on_day,
    estimate_sales_revenue,
    estimate_sales_row,
    estimate_unit_price,
    mechanic_multiplier,
    voucher_multiplier,
)


def test_three_mechanics_and_stacked_voucher():
    assert mechanic_multiplier("Buy 2 Get 1 Free") == Decimal(2) / 3
    assert mechanic_multiplier("Buy 2 Get 30% Off") == Decimal("0.85")
    assert mechanic_multiplier("30% Off") == Decimal("0.70")
    assert mechanic_multiplier("Voucher") == Decimal(1)
    assert voucher_multiplier("$3 off $30") == Decimal("0.9")
    assert estimate_unit_price(Decimal(20), "Buy 2 Get 30% Off", "$3 off $30") == Decimal("15.30")
    assert mechanic_multiplier("Flash deal") is None


def test_weekly_side_offer_overrides_monthly_for_its_days():
    sale = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 10),
        "quantity_units": 10, "revenue": None,
    }
    month = {
        "promotion_id": 1, "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 31),
        "promo_type": "monthly", "promotion_mechanic": "20% Off", "voucher": None,
    }
    side = {
        **month, "promotion_id": 2,
        "period_start": date(2026, 1, 5), "period_end": date(2026, 1, 7),
        "promo_type": "side_offer", "promotion_mechanic": "Buy 1 Get 1 Free",
    }
    result = estimate_sales_row(sale, {}, {"SKU-1": Decimal(10)}, [month, side])
    assert result["estimated_revenue"] == 71.0  # 7 days at $8 + 3 days at $5
    assert result["effective_multiplier"] == 0.71
    assert result["estimated_discount_percent"] == 29.0
    assert result["promotion_ids"] == [1, 2]
    assert result["revenue"] is None


def test_weekly_mechanic_keeps_monthly_voucher_when_weekly_voucher_is_blank():
    sale = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 5), "period_end": date(2026, 1, 5),
        "quantity_units": 1, "revenue": None,
    }
    common = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 31),
    }
    promos = [
        {**common, "promotion_id": 1, "promo_type": "monthly",
         "promotion_mechanic": "20% Off", "voucher": "$3 off $30"},
        {**common, "promotion_id": 2, "promo_type": "side_offer",
         "promotion_mechanic": "Buy 1 Get 1 Free", "voucher": None},
    ]
    result = estimate_sales_row(sale, {}, {"SKU-1": Decimal(20)}, promos)
    assert result["estimated_revenue"] == 9.0  # $20 * 0.5 * 0.9
    assert result["promotion_ids"] == [1, 2]


def test_historical_price_is_selected_by_sale_day():
    sale = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 2, 1), "period_end": date(2026, 2, 2),
        "quantity_units": 2, "revenue": None,
    }
    versions = {"SKU-1": [
        {"action": "created", "price": Decimal(10),
         "changed_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
        {"action": "updated", "price": Decimal(12),
         "changed_at": datetime(2026, 2, 2, tzinfo=timezone.utc)},
    ]}
    result = estimate_sales_row(sale, versions, {"SKU-1": Decimal(99)}, [])
    assert result["estimated_revenue"] == 22.0
    assert result["price_assumed_before_history"] is False


def test_future_price_starts_on_its_effective_date():
    periods = [
        {"price": Decimal("10"), "effective_from": date(1900, 1, 1),
         "effective_to": date(2026, 11, 30)},
        {"price": Decimal("12"), "effective_from": date(2026, 12, 1),
         "effective_to": None},
    ]
    assert _price_on_day(periods, date(2026, 11, 30), Decimal("12"))[0] == Decimal("10")
    assert _price_on_day(periods, date(2026, 12, 1), Decimal("12"))[0] == Decimal("12")


def test_actual_revenue_is_never_replaced_and_ambiguous_promos_are_flagged():
    sale = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 1),
        "quantity_units": 1, "revenue": Decimal("2.50"),
    }
    actual_result = estimate_sales_row(sale, {}, {"SKU-1": Decimal(10)}, [])
    assert actual_result["revenue_source"] == "actual"
    assert actual_result["revenue"] == Decimal("2.50")
    assert actual_result["estimated_revenue"] is None
    sale["revenue"] = None
    base = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 1),
        "promo_type": "monthly", "voucher": None,
    }
    promos = [
        {**base, "promotion_id": 1, "promotion_mechanic": "20% Off"},
        {**base, "promotion_id": 2, "promotion_mechanic": "30% Off"},
    ]
    result = estimate_sales_row(sale, {}, {"SKU-1": Decimal(10)}, promos)
    assert result["estimated_revenue"] is None
    assert "Overlapping promotions" in result["pricing_issue"]


def test_actual_only_batch_does_not_query_catalog(monkeypatch):
    def no_database():
        raise AssertionError("Actual revenue must bypass estimated pricing")

    monkeypatch.setattr("app.services.promotion_pricing._get_read_engine", no_database)
    rows = [{
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 31),
        "quantity_units": 10, "revenue": Decimal("25.00"),
    }]
    result = estimate_sales_revenue(rows)
    assert result[0]["revenue"] == Decimal("25.00")
    assert result[0]["estimated_revenue"] is None


def test_revenue_estimate_route_maps_database_outage_to_503(monkeypatch):
    def unavailable(_rows):
        raise OperationalError("SELECT 1", {}, RuntimeError("database unavailable"))

    monkeypatch.setattr(promotions.promotion_pricing, "estimate_sales_revenue", unavailable)
    app = FastAPI()
    app.include_router(promotions.router)
    response = TestClient(app).post("/api/promotions/revenue-estimate", json={"rows": [{
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": "2026-01-01", "period_end": "2026-01-31",
        "quantity_units": 10,
    }]})

    assert response.status_code == 503
    assert "Unable to reach the pricing database" in response.json()["detail"]


def test_batch_applies_only_promotions_at_the_rows_own_store(monkeypatch):
    sale = {
        "sku": "SKU-1", "retailer_id": 55, "store_code": "4",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 10),
        "quantity_units": 10, "revenue": None,
    }
    other_store = {
        "promotion_id": 9, "sku": "SKU-1", "retailer_id": 55, "store_code": "5",
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 31),
        "promo_type": "monthly", "promotion_mechanic": "50% Off", "voucher": None,
    }

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def mappings(self):
            return self

        def all(self):
            return self._rows

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, statement, params):
            sql = str(statement)
            if "FROM skus" in sql:
                return _Result([{"sku": "SKU-1", "price": Decimal(10)}])
            if "FROM promotions" in sql:
                return _Result([other_store])
            return _Result([])

    class _Engine:
        def connect(self):
            return _Conn()

    monkeypatch.setattr("app.services.promotion_pricing._get_read_engine", lambda: _Engine())

    (result,) = estimate_sales_revenue([sale])

    assert result["estimated_revenue"] == 100.0
    assert result["promotion_ids"] == []
