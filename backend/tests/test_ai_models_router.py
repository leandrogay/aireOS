from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_models

client = TestClient(app)


def test_status_returns_the_service_result(monkeypatch):
    status = {
        "mapping": {"model": "gemini-old", "available": False, "message": "gone"},
        "assistant": {"model": "gemini-new", "available": True, "message": None},
    }
    monkeypatch.setattr(ai_models, "model_status", lambda: status)

    response = client.get("/api/ai-models/status")

    assert response.status_code == 200
    assert response.json() == status
