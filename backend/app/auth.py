"""FastAPI authentication dependency shared by every protected router."""

from fastapi import HTTPException, Request

from app import config
from app.services import auth_service


def require_user(request: Request) -> dict:
    """Return the signed-in user or reject the request before domain logic runs."""
    if not config.auth_enabled():
        return {
            "sub": "local-development",
            "email": "local@shop-aire.com",
            "name": "Local development",
            "picture": None,
        }

    token = request.cookies.get(auth_service.SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return auth_service.read_session(token)
    except (auth_service.InvalidSessionError, config.ConfigError) as exc:
        raise HTTPException(status_code=401, detail="Authentication required") from exc
