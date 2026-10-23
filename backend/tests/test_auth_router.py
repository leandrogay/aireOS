import logging

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.services import auth_service


@pytest.fixture
def client():
    """Give each auth test an isolated cookie jar."""
    return TestClient(app)


def test_login_redirects_to_google_and_sets_state_cookie(monkeypatch, client):
    monkeypatch.setattr(config, "AUTH_ENABLED", "true")
    monkeypatch.setattr(
        auth_service,
        "begin_login",
        lambda _next: auth_service.LoginRequest(
            authorization_url="https://accounts.google.com/o/oauth2/v2/auth?state=abc",
            state_cookie="signed-state",
        ),
    )

    response = client.get("/api/auth/login", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://accounts.google.com/")
    assert auth_service.OAUTH_STATE_COOKIE in response.cookies


def test_me_rejects_request_without_session_when_auth_is_enabled(monkeypatch, client):
    monkeypatch.setattr(config, "AUTH_ENABLED", "true")

    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_callback_sets_session_cookie_and_redirects_home(monkeypatch, client):
    monkeypatch.setattr(config, "AUTH_FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setattr(
        auth_service,
        "complete_login",
        lambda _code, _state, _cookie: auth_service.LoginResult(
            session_token="signed-session",
            next_path="/dashboard",
        ),
    )

    client.cookies.set(auth_service.OAUTH_STATE_COOKIE, "signed-state")
    try:
        response = client.get(
            "/api/auth/callback?code=code&state=state",
            follow_redirects=False,
        )
    finally:
        client.cookies.delete(auth_service.OAUTH_STATE_COOKIE)

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/dashboard"
    assert response.cookies[auth_service.SESSION_COOKIE] == "signed-session"


def test_callback_logs_provider_failure_without_exposing_request_values(
    monkeypatch, caplog, client
):
    monkeypatch.setattr(config, "AUTH_FRONTEND_URL", "http://localhost:3000")

    def fail_login(_code, _state, _cookie):
        raise auth_service.AuthProviderError("Google rejected the token exchange")

    monkeypatch.setattr(auth_service, "complete_login", fail_login)
    client.cookies.set(auth_service.OAUTH_STATE_COOKIE, "signed-state")
    try:
        with caplog.at_level(logging.ERROR, logger="app.routers.auth"):
            response = client.get(
                "/api/auth/callback?code=sensitive-code&state=sensitive-state",
                follow_redirects=False,
            )
    finally:
        client.cookies.delete(auth_service.OAUTH_STATE_COOKIE)

    assert response.status_code == 302
    assert response.headers["location"] == (
        "http://localhost:3000/login?error=authentication_failed"
    )
    assert "Google authentication provider failed" in caplog.text
    assert "sensitive-code" not in caplog.text
    assert "sensitive-state" not in caplog.text


def test_internal_api_rejects_request_without_session_when_auth_is_enabled(
    monkeypatch, client
):
    monkeypatch.setattr(config, "AUTH_ENABLED", "true")

    response = client.get("/api/sales/customer-options")

    assert response.status_code == 401


def test_me_returns_signed_in_user(monkeypatch, client):
    monkeypatch.setattr(config, "AUTH_ENABLED", "true")
    monkeypatch.setattr(config, "AUTH_SESSION_SECRET", "a-test-secret-that-is-long-enough")
    token = auth_service.create_session(
        {"sub": "google-user-1", "email": "staff@shop-aire.com", "name": "Aire Staff"}
    )

    client.cookies.set(auth_service.SESSION_COOKIE, token)
    try:
        response = client.get("/api/auth/me")
    finally:
        client.cookies.delete(auth_service.SESSION_COOKIE)

    assert response.status_code == 200
    assert response.json()["email"] == "staff@shop-aire.com"
