import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import app
from app.services import assistant, sellout_service

client = TestClient(app)

# Every dashboard endpoint and the sellout_service function it calls.
SALES_ENDPOINTS = [
    ("/api/sales/skus", "get_sku_ranking"),
    ("/api/sales/sku-options", "get_sku_options"),
    ("/api/sales/store-options", "get_store_options"),
    ("/api/sales/customer-options", "get_customer_options"),
    ("/api/sales/customer-totals", "get_customer_totals"),
    ("/api/sales/customer-trends", "get_customer_trends"),
    ("/api/sales/dashboard-summary", "get_dashboard_summary"),
    ("/api/sales/monthly-only", "get_monthly_only_months"),
    ("/api/sales/period-comparison", "get_period_comparison"),
    ("/api/sales/default-date-range", "get_default_date_range"),
    ("/api/sales/last-updated", "get_data_freshness"),
]


def _outage(*args, **kwargs):
    raise OperationalError("SELECT 1", {}, Exception("connection refused"))


# ---- Cloud SQL outage -> 503 with a readable message --------------------------------

@pytest.mark.parametrize("url, function_name", SALES_ENDPOINTS)
def test_sales_endpoint_maps_a_database_outage_to_503(monkeypatch, url, function_name):
    monkeypatch.setattr(sellout_service, function_name, _outage)

    response = client.get(url)

    assert response.status_code == 503
    assert "sales database" in response.json()["detail"].lower()


def test_digest_endpoint_maps_a_database_outage_to_503(monkeypatch):
    monkeypatch.setattr(assistant, "generate_digest", _outage)

    response = client.post("/api/assistant/digest", json={})

    assert response.status_code == 503


# ---- /api/sales/monthly-only ---------------------------------------------

def test_monthly_only_maps_a_bad_date_to_400(monkeypatch):
    def _bad_date(**kwargs):
        raise ValueError("start_date must be in YYYY-MM-DD format")

    monkeypatch.setattr(sellout_service, "get_monthly_only_months", _bad_date)

    response = client.get("/api/sales/monthly-only?start_date=Aug")

    assert response.status_code == 400
    assert "start_date" in response.json()["detail"]


def test_monthly_only_returns_the_months_per_channel(monkeypatch):
    monkeypatch.setattr(sellout_service, "get_monthly_only_months", lambda **kwargs: {"offline": ["2026-08-01"], "online": []})

    response = client.get("/api/sales/monthly-only?customer=fairprice")

    assert response.status_code == 200
    assert response.json() == {"offline": ["2026-08-01"], "online": []}


# ---- /api/sales/store-options ---------------------------------------------

def test_store_options_maps_an_unknown_mode_to_400():
    response = client.get("/api/sales/store-options?customer=sheng_siong&mode=ecomm")

    assert response.status_code == 400
    assert "mode" in response.json()["detail"]


def test_store_options_passes_the_channel_to_the_service(monkeypatch):
    calls = []

    def _options(**kwargs):
        calls.append(kwargs)
        return [{"store_code": "6M_Ecomm", "store_name": "6M_Ecomm"}]

    monkeypatch.setattr(sellout_service, "get_store_options", _options)

    response = client.get("/api/sales/store-options?customer=sheng_siong&mode=online")

    assert response.status_code == 200
    assert calls == [{"customer": "sheng_siong", "mode": "online"}]
    assert response.json() == {"options": [{"store_code": "6M_Ecomm", "store_name": "6M_Ecomm"}]}


def test_skus_maps_blank_customers_to_400():
    response = client.get("/api/sales/skus?customers=,")

    assert response.status_code == 400
    assert "customers" in response.json()["detail"]


def test_customer_totals_maps_a_bad_date_to_400(monkeypatch):
    def _bad_date(**kwargs):
        raise ValueError("start_date must be in YYYY-MM-DD format")

    monkeypatch.setattr(sellout_service, "get_customer_totals", _bad_date)

    response = client.get("/api/sales/customer-totals?customers=fairprice&start_date=Aug")

    assert response.status_code == 400
    assert "start_date" in response.json()["detail"]


def test_customer_trends_passes_its_filters_to_the_service(monkeypatch):
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return {"granularity": "week", "customers": []}

    monkeypatch.setattr(sellout_service, "get_customer_trends", fake)

    response = client.get(
        "/api/sales/customer-trends?customers=fairprice,nhg&granularity=week&sku=A1"
        "&start_date=2026-05-01&end_date=2026-07-31"
    )

    assert response.status_code == 200
    assert seen == {
        "customers": ["fairprice", "nhg"],
        "granularity": "week",
        "sku": "A1",
        "start_date": "2026-05-01",
        "end_date": "2026-07-31",
    }


def test_customer_trends_maps_bad_input_to_400(monkeypatch):
    def _bad_granularity(**kwargs):
        raise ValueError("granularity must be one of ('week', 'month')")

    monkeypatch.setattr(sellout_service, "get_customer_trends", _bad_granularity)

    response = client.get("/api/sales/customer-trends?customers=a,b&granularity=day")

    assert response.status_code == 400
    assert "granularity" in response.json()["detail"]


def test_default_date_range_passes_ticked_customers_as_a_list(monkeypatch):
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return {"start": None, "end": None, "period_type": None, "earliest_start": None, "latest_week_start": None}

    monkeypatch.setattr(sellout_service, "get_default_date_range", fake)

    response = client.get("/api/sales/default-date-range?customers=fairprice,prime&mode=offline&period=week")

    assert response.status_code == 200
    assert seen["customers"] == ["fairprice", "prime"]
    assert (seen["mode"], seen["period"]) == ("offline", "week")


def test_monthly_only_passes_ticked_customers_through(monkeypatch):
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return {"offline": [], "online": []}

    monkeypatch.setattr(sellout_service, "get_monthly_only_months", fake)

    response = client.get("/api/sales/monthly-only?customers=fairprice,prime&start_date=2026-10-01&end_date=2026-10-31")

    assert response.status_code == 200
    assert seen["customers"] == ["fairprice", "prime"]
