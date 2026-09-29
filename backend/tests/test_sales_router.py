import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import assistant, bigquery, sellout_lookup

client = TestClient(app)

# Every dashboard endpoint and the bigquery.py function it calls. All of them
# resolve names through sellout_lookup, so all of them can hit a Cloud SQL outage.
SALES_ENDPOINTS = [
    ("/api/sales/skus", "get_sku_ranking"),
    ("/api/sales/sku-options", "get_sku_options"),
    ("/api/sales/store-options", "get_store_options"),
    ("/api/sales/customer-options", "get_customer_options"),
    ("/api/sales/dashboard-summary", "get_dashboard_summary"),
    ("/api/sales/period-comparison", "get_period_comparison"),
    ("/api/sales/default-date-range", "get_default_date_range"),
    ("/api/sales/last-updated", "get_data_freshness"),
]


def _outage(*args, **kwargs):
    raise sellout_lookup.CatalogUnavailableError("OperationalError: connection refused")


# ---- catalog outage -> 503 with a readable message ---------------------------------

@pytest.mark.parametrize("url, function_name", SALES_ENDPOINTS)
def test_sales_endpoint_maps_a_catalog_outage_to_503(monkeypatch, url, function_name):
    monkeypatch.setattr(bigquery, function_name, _outage)

    response = client.get(url)

    assert response.status_code == 503
    assert "catalog" in response.json()["detail"].lower()


def test_digest_endpoint_maps_a_catalog_outage_to_503(monkeypatch):
    monkeypatch.setattr(assistant, "generate_digest", _outage)

    response = client.post("/api/assistant/digest", json={})

    assert response.status_code == 503
    assert "catalog" in response.json()["detail"].lower()
