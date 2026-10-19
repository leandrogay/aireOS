import urllib.parse

import pytest

from app import config
from app.services import auth_service


def _configure(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(config, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(config, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/api/auth/callback")
    monkeypatch.setattr(config, "AUTH_SESSION_SECRET", "a-test-secret-that-is-long-enough")
    monkeypatch.setattr(config, "AUTH_ALLOWED_DOMAIN", "shop-aire.com")


def test_begin_login_builds_workspace_authorization_request(monkeypatch):
    _configure(monkeypatch)

    request = auth_service.begin_login("/dashboard", now=1_000)
    query = urllib.parse.parse_qs(urllib.parse.urlparse(request.authorization_url).query)
    state = auth_service.read_oauth_state(request.state_cookie, now=1_001)

    assert query["client_id"] == ["client-id"]
    assert query["redirect_uri"] == ["http://localhost:8000/api/auth/callback"]
    assert query["scope"] == ["openid email profile"]
    assert query["hd"] == ["shop-aire.com"]
    assert query["state"] == [state["state"]]
    assert query["nonce"] == [state["nonce"]]
    assert state["next"] == "/dashboard"


def test_callback_accepts_verified_workspace_user(monkeypatch):
    _configure(monkeypatch)
    login = auth_service.begin_login("/inventory", now=1_000)
    state = auth_service.read_oauth_state(login.state_cookie, now=1_001)
    monkeypatch.setattr(auth_service, "_exchange_code", lambda _code: "id-token")
    monkeypatch.setattr(
        auth_service,
        "_verify_id_token",
        lambda _token: {
            "sub": "google-user-1",
            "email": "staff@shop-aire.com",
            "email_verified": True,
            "hd": "shop-aire.com",
            "name": "Aire Staff",
            "nonce": state["nonce"],
        },
    )

    result = auth_service.complete_login(
        "authorization-code",
        state["state"],
        login.state_cookie,
        now=1_002,
    )
    session = auth_service.read_session(result.session_token, now=1_003)

    assert result.next_path == "/inventory"
    assert session == {
        "sub": "google-user-1",
        "email": "staff@shop-aire.com",
        "name": "Aire Staff",
        "picture": None,
    }


def test_callback_rejects_user_outside_workspace(monkeypatch):
    _configure(monkeypatch)
    login = auth_service.begin_login("/dashboard", now=1_000)
    state = auth_service.read_oauth_state(login.state_cookie, now=1_001)
    monkeypatch.setattr(auth_service, "_exchange_code", lambda _code: "id-token")
    monkeypatch.setattr(
        auth_service,
        "_verify_id_token",
        lambda _token: {
            "sub": "google-user-2",
            "email": "outsider@gmail.com",
            "email_verified": True,
            "nonce": state["nonce"],
        },
    )

    with pytest.raises(auth_service.UnauthorizedDomainError):
        auth_service.complete_login(
            "authorization-code",
            state["state"],
            login.state_cookie,
            now=1_002,
        )


def test_session_rejects_tampering(monkeypatch):
    _configure(monkeypatch)
    token = auth_service.create_session(
        {"sub": "1", "email": "staff@shop-aire.com"},
        now=1_000,
    )

    with pytest.raises(auth_service.InvalidSessionError):
        auth_service.read_session(f"{token}changed", now=1_001)


def test_session_rejects_expired_token(monkeypatch):
    _configure(monkeypatch)
    token = auth_service.create_session(
        {"sub": "1", "email": "staff@shop-aire.com"},
        now=1_000,
    )

    with pytest.raises(auth_service.InvalidSessionError):
        auth_service.read_session(
            token,
            now=1_000 + auth_service.SESSION_MAX_AGE_SECONDS + 1,
        )
