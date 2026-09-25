from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError

from fastapi.testclient import TestClient

from app.main import app
from app.services import bigquery

client = TestClient(app)


# ---- GET /api/forecast/inventory -------------------------------------------------


def test_returns_rows_on_success(monkeypatch):
    monkeypatch.setattr(bigquery, "get_inventory_position_rows", lambda **kwargs: [{"month_year": "2026-06-01"}])

    response = client.get("/api/forecast/inventory", params={"product_name": "Widget"})

    assert response.status_code == 200
    body = response.json()
    assert body["product_name"] == "Widget"
    assert body["rows"] == [{"month_year": "2026-06-01"}]


def test_bad_date_maps_to_400(monkeypatch):
    def _raise(**kwargs):
        raise ValueError("start_date must be in YYYY-MM-DD format")

    monkeypatch.setattr(bigquery, "get_inventory_position_rows", _raise)

    response = client.get("/api/forecast/inventory", params={"start_date": "01-01-2026"})

    assert response.status_code == 400
    assert "start_date" in response.json()["detail"]


def test_missing_credentials_maps_to_503(monkeypatch):
    def _raise(**kwargs):
        raise DefaultCredentialsError("no credentials")

    monkeypatch.setattr(bigquery, "get_inventory_position_rows", _raise)

    response = client.get("/api/forecast/inventory")

    assert response.status_code == 503
    assert "GOOGLE_APPLICATION_CREDENTIALS" in response.json()["detail"]


def test_bigquery_unavailable_maps_to_503(monkeypatch):
    def _raise(**kwargs):
        raise GoogleAPICallError("timeout")

    monkeypatch.setattr(bigquery, "get_inventory_position_rows", _raise)

    response = client.get("/api/forecast/inventory")

    assert response.status_code == 503
    assert "Unable to reach BigQuery" in response.json()["detail"]
