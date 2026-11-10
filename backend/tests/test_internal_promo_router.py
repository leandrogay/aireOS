from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import internal_forecast, internal_promo
from app.services.settings import promo_recalc


URL = "https://api.example/internal/promo/recalc"


def _client():
    app = FastAPI()
    app.include_router(internal_promo.router)
    return TestClient(app)


def test_the_callback_is_503_while_recalculation_tasks_are_off(monkeypatch):
    monkeypatch.setattr(internal_promo.config, "PROMO_RECALC_ENABLED", "false")

    assert _client().post("/internal/promo/recalc").status_code == 503


def test_the_callback_rejects_a_caller_without_the_task_identity(monkeypatch):
    monkeypatch.setattr(internal_promo.config, "PROMO_RECALC_ENABLED", "true")
    monkeypatch.setattr(internal_promo.config, "PROMO_RECALC_HANDLER_URL", URL)

    client = _client()

    assert client.post("/internal/promo/recalc").status_code == 401
    assert client.post("/internal/promo/recalc", headers={"Authorization": "Bearer forged"}).status_code == 401


def test_the_task_identity_runs_the_queue_against_the_promo_handlers_audience(monkeypatch):
    seen = {}
    monkeypatch.setattr(internal_promo.config, "PROMO_RECALC_ENABLED", "true")
    monkeypatch.setattr(internal_promo.config, "PROMO_RECALC_HANDLER_URL", URL)
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_INVOKER", "task@example.iam.gserviceaccount.com")

    def verify(token, request, audience):
        seen["audience"] = audience
        return {"email": "task@example.iam.gserviceaccount.com", "email_verified": True}

    monkeypatch.setattr(internal_forecast.id_token, "verify_oauth2_token", verify)
    monkeypatch.setattr(promo_recalc, "process_pending", lambda: {"customers": [], "failed": []})

    response = _client().post("/internal/promo/recalc", headers={"Authorization": "Bearer task-token"})

    assert response.status_code == 200
    assert seen["audience"] == "https://api.example"
