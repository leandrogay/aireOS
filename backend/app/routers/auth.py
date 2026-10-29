"""Google Workspace login, callback, session inspection, and logout routes."""

import logging
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app import config
from app.auth import require_user
from app.services import auth_service


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _frontend_url(path: str) -> str:
    return f"{config.AUTH_FRONTEND_URL.rstrip('/')}{path}"


def _login_error(code: str) -> RedirectResponse:
    query = urllib.parse.urlencode({"error": code})
    return RedirectResponse(_frontend_url(f"/login?{query}"), status_code=302)


def _set_cookie(response, key: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key,
        value,
        max_age=max_age,
        httponly=True,
        secure=config.auth_cookie_secure(),
        samesite="lax",
        path="/",
        domain=config.AUTH_COOKIE_DOMAIN or None,
    )


@router.get("/login")
def login(next: str = "/dashboard"):
    try:
        login_request = auth_service.begin_login(next)
    except config.ConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    response = RedirectResponse(login_request.authorization_url, status_code=302)
    _set_cookie(
        response,
        auth_service.OAUTH_STATE_COOKIE,
        login_request.state_cookie,
        auth_service.OAUTH_STATE_MAX_AGE_SECONDS,
    )
    return response


@router.get("/callback")
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return _login_error("access_denied")
    if not code or not state:
        return _login_error("invalid_response")

    state_cookie = request.cookies.get(auth_service.OAUTH_STATE_COOKIE)
    if not state_cookie:
        return _login_error("invalid_state")

    try:
        result = auth_service.complete_login(code, state, state_cookie)
    except auth_service.UnauthorizedDomainError:
        return _login_error("unauthorized_domain")
    except auth_service.InvalidSessionError:
        return _login_error("invalid_state")
    except auth_service.AuthProviderError:
        logger.exception("Google authentication provider failed")
        return _login_error("authentication_failed")
    except config.ConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    response = RedirectResponse(_frontend_url(result.next_path), status_code=302)
    _set_cookie(
        response,
        auth_service.SESSION_COOKIE,
        result.session_token,
        auth_service.SESSION_MAX_AGE_SECONDS,
    )
    response.delete_cookie(
        auth_service.OAUTH_STATE_COOKIE,
        path="/",
        domain=config.AUTH_COOKIE_DOMAIN or None,
    )
    return response


@router.get("/me")
def me(user: dict = Depends(require_user)):
    return user


@router.post("/logout")
def logout():
    response = JSONResponse({"status": "signed_out"})
    response.delete_cookie(
        auth_service.SESSION_COOKIE,
        path="/",
        domain=config.AUTH_COOKIE_DOMAIN or None,
    )
    return response
