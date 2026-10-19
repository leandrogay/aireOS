"""Google Workspace OpenID Connect and signed AireOS browser sessions."""

import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app import config


AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SESSION_COOKIE = "aireos_session"
OAUTH_STATE_COOKIE = "aireos_oauth_state"
SESSION_MAX_AGE_SECONDS = 8 * 60 * 60
OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60


class InvalidSessionError(ValueError):
    """The session or OAuth state token is missing, invalid, or expired."""


class UnauthorizedDomainError(ValueError):
    """Google authenticated the user, but not as an allowed Workspace member."""


class AuthProviderError(RuntimeError):
    """Google could not complete the authorization-code exchange."""


@dataclass(frozen=True)
class LoginRequest:
    authorization_url: str
    state_cookie: str


@dataclass(frozen=True)
class LoginResult:
    session_token: str
    next_path: str


def _timestamp(now: int | None = None) -> int:
    return int(time.time() if now is None else now)


def _encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f"{value}{padding}")
    except (ValueError, TypeError) as exc:
        raise InvalidSessionError("Invalid authentication token") from exc


def _session_secret() -> bytes:
    secret = config.require("AUTH_SESSION_SECRET")
    if len(secret) < 32:
        raise config.ConfigError("AUTH_SESSION_SECRET must contain at least 32 characters")
    return secret.encode("utf-8")


def _sign(payload: dict[str, Any], purpose: str, expires_in: int, now: int | None = None) -> str:
    issued_at = _timestamp(now)
    body = {
        **payload,
        "purpose": purpose,
        "iat": issued_at,
        "exp": issued_at + expires_in,
    }
    encoded = _encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    secret = _session_secret()
    signature = _encode(hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def _unsign(token: str, purpose: str, now: int | None = None) -> dict[str, Any]:
    try:
        encoded, supplied_signature = token.split(".", 1)
    except (AttributeError, ValueError) as exc:
        raise InvalidSessionError("Invalid authentication token") from exc

    secret = _session_secret()
    expected_signature = _encode(
        hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise InvalidSessionError("Invalid authentication token")

    try:
        payload = json.loads(_decode(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidSessionError("Invalid authentication token") from exc

    current_time = _timestamp(now)
    if payload.get("purpose") != purpose or payload.get("exp", 0) < current_time:
        raise InvalidSessionError("Authentication token has expired or is invalid")
    return payload


def _safe_next_path(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/dashboard"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return "/dashboard"
    return value


def begin_login(next_path: str = "/dashboard", now: int | None = None) -> LoginRequest:
    """Build Google's authorization URL and the signed browser state cookie."""
    client_id = config.require("GOOGLE_OAUTH_CLIENT_ID")
    redirect_uri = config.require("GOOGLE_OAUTH_REDIRECT_URI")
    allowed_domain = config.require("AUTH_ALLOWED_DOMAIN").lower()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    state_cookie = _sign(
        {"state": state, "nonce": nonce, "next": _safe_next_path(next_path)},
        "oauth_state",
        OAUTH_STATE_MAX_AGE_SECONDS,
        now,
    )
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "hd": allowed_domain,
            "prompt": "select_account",
        }
    )
    return LoginRequest(f"{AUTHORIZATION_ENDPOINT}?{query}", state_cookie)


def read_oauth_state(token: str, now: int | None = None) -> dict[str, Any]:
    """Verify and return a short-lived OAuth state cookie."""
    return _unsign(token, "oauth_state", now)


def _exchange_code(code: str) -> str:
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": config.require("GOOGLE_OAUTH_CLIENT_ID"),
            "client_secret": config.require("GOOGLE_OAUTH_CLIENT_SECRET"),
            "redirect_uri": config.require("GOOGLE_OAUTH_REDIRECT_URI"),
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        TOKEN_ENDPOINT,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read())
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise AuthProviderError("Google could not complete the sign-in request") from exc

    token = result.get("id_token")
    if not token:
        raise AuthProviderError("Google did not return an identity token")
    return token


def _verify_id_token(token: str) -> dict[str, Any]:
    try:
        return id_token.verify_oauth2_token(
            token,
            GoogleRequest(),
            config.require("GOOGLE_OAUTH_CLIENT_ID"),
        )
    except ValueError as exc:
        raise AuthProviderError("Google returned an invalid identity token") from exc


def create_session(user: dict[str, Any], now: int | None = None) -> str:
    """Create a signed, expiring browser session containing safe profile fields."""
    return _sign(
        {
            "sub": str(user["sub"]),
            "email": str(user["email"]),
            "name": user.get("name"),
            "picture": user.get("picture"),
        },
        "session",
        SESSION_MAX_AGE_SECONDS,
        now,
    )


def read_session(token: str, now: int | None = None) -> dict[str, Any]:
    """Verify a browser session and return its public user identity."""
    payload = _unsign(token, "session", now)
    if not payload.get("sub") or not payload.get("email"):
        raise InvalidSessionError("Session identity is incomplete")
    return {
        "sub": payload["sub"],
        "email": payload["email"],
        "name": payload.get("name"),
        "picture": payload.get("picture"),
    }


def complete_login(
    code: str,
    state: str,
    state_cookie: str,
    now: int | None = None,
) -> LoginResult:
    """Exchange Google's code, enforce the Workspace domain, and issue a session."""
    saved = read_oauth_state(state_cookie, now)
    if not secrets.compare_digest(str(saved.get("state", "")), state):
        raise InvalidSessionError("OAuth state did not match")

    claims = _verify_id_token(_exchange_code(code))
    if not secrets.compare_digest(str(claims.get("nonce", "")), str(saved.get("nonce", ""))):
        raise InvalidSessionError("OAuth nonce did not match")

    allowed_domain = config.require("AUTH_ALLOWED_DOMAIN").lower()
    hosted_domain = str(claims.get("hd", "")).lower()
    email = str(claims.get("email", "")).lower()
    if (
        hosted_domain != allowed_domain
        or not email.endswith(f"@{allowed_domain}")
        or claims.get("email_verified") is not True
    ):
        raise UnauthorizedDomainError(
            f"Only verified {allowed_domain} Google Workspace accounts may sign in"
        )
    if not claims.get("sub"):
        raise AuthProviderError("Google identity token has no subject")

    session = create_session(
        {
            "sub": claims["sub"],
            "email": email,
            "name": claims.get("name"),
            "picture": claims.get("picture"),
        },
        now,
    )
    return LoginResult(session, _safe_next_path(saved.get("next")))
