from fastapi.testclient import TestClient

from app.main import app
from app.services import notification_service

client = TestClient(app)


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


def test_list_notifications_passes_the_query_params_to_the_service(monkeypatch):
    seen = {}

    def fake(unread_only, limit):
        seen.update(unread_only=unread_only, limit=limit)
        return []

    monkeypatch.setattr(notification_service, "list_notifications", fake)

    response = client.get("/api/notifications?unread_only=true&limit=10")

    assert response.status_code == 200
    assert seen == {"unread_only": True, "limit": 10}


def test_list_notifications_defaults_to_every_notification(monkeypatch):
    monkeypatch.setattr(notification_service, "list_notifications", lambda unread_only, limit: [{"a": 1}])

    response = client.get("/api/notifications")

    assert response.status_code == 200
    assert response.json() == [{"a": 1}]


def test_list_notifications_maps_an_unexpected_failure_to_a_500(monkeypatch):
    monkeypatch.setattr(notification_service, "list_notifications", _raises(RuntimeError("db down")))

    response = client.get("/api/notifications")

    assert response.status_code == 500
    assert "RuntimeError: db down" in response.json()["detail"]


def test_unread_count_returns_the_services_count(monkeypatch):
    monkeypatch.setattr(notification_service, "unread_count", lambda: 4)

    response = client.get("/api/notifications/unread-count")

    assert response.status_code == 200
    assert response.json() == {"unread_count": 4}


def test_mark_read_passes_the_ids_to_the_service(monkeypatch):
    seen = {}

    def fake(notification_ids):
        seen["notification_ids"] = notification_ids
        return 2

    monkeypatch.setattr(notification_service, "mark_read", fake)

    response = client.post("/api/notifications/mark-read", json={"notification_ids": [1, 2]})

    assert response.status_code == 200
    assert response.json() == {"marked_read": 2}
    assert seen == {"notification_ids": [1, 2]}


def test_mark_read_rejects_an_empty_list_without_calling_the_service(monkeypatch):
    monkeypatch.setattr(notification_service, "mark_read", _raises(AssertionError("service was called")))

    response = client.post("/api/notifications/mark-read", json={"notification_ids": []})

    assert response.status_code == 422
