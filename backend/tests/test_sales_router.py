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
