from fastapi.testclient import TestClient
from google.auth.exceptions import DefaultCredentialsError

from app.main import app
from app.services import forecast_service


def test_forecast_route_returns_combined_payload(monkeypatch):
    monkeypatch.setattr(
        forecast_service,
        "get_forecast_view",
        lambda **kwargs: {
            "product_name": kwargs.get("product_name"),
            "customer_name": kwargs.get("customer_name"),
            "start_date": kwargs.get("start_date"),
            "end_date": kwargs.get("end_date"),
            "tier": kwargs.get("tier"),
            "rows": [],
            "actuals": [{"month_year": "2026-08-01", "quantity_cartons": 209.0}],
            "promotions": [{"promo_type": "monthly"}],
            "freshness": {
                "forecast_by_tier": {"0": "2026-08-31", "1": "2026-08-31"},
                "latest_sales_loaded_at": "2026-09-27T06:32:01Z",
            },
        },
    )
    client = TestClient(app)
    response = client.get("/api/forecast/", params={"customer_name": "fairprice", "tier": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["tier"] == 1
    assert body["rows"] == []
    assert body["actuals"][0]["quantity_cartons"] == 209.0
    assert body["promotions"][0]["promo_type"] == "monthly"
    assert body["freshness"]["forecast_by_tier"]["1"] == "2026-08-31"


def test_forecast_route_maps_bad_dates_to_400(monkeypatch):
    def _boom(**kwargs):
        raise ValueError("start_date must be in YYYY-MM-DD format")

    monkeypatch.setattr(forecast_service, "get_forecast_view", _boom)
    client = TestClient(app)
    response = client.get("/api/forecast/", params={"start_date": "01-01-2026"})

    assert response.status_code == 400
    assert "start_date" in response.json()["detail"]


def test_forecast_route_maps_missing_credentials_to_503(monkeypatch):
    def _boom(**kwargs):
        raise DefaultCredentialsError("missing")

    monkeypatch.setattr(forecast_service, "get_forecast_view", _boom)
    client = TestClient(app)
    response = client.get("/api/forecast/")

    assert response.status_code == 503
    assert "GOOGLE_APPLICATION_CREDENTIALS" in response.json()["detail"]
