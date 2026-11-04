"""Cloud Tasks callback for event-driven forecast refresh."""

from fastapi import APIRouter, HTTPException, Request
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app import config
from app.services import forecast_refresh_events, forecast_refresh_worker

router = APIRouter(prefix="/internal/forecast", tags=["forecast"])


def _verify_task(request: Request) -> None:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing task identity")
    try:
        claims = id_token.verify_oauth2_token(
            authorization[7:], GoogleRequest(), forecast_refresh_events.handler_audience()
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid task identity") from exc
    if (
        claims.get("email") != config.FORECAST_REFRESH_INVOKER
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(status_code=403, detail="Task caller is not allowed")


@router.post("/refresh-check")
def refresh_check(request: Request):
    """Only the dedicated Cloud Tasks identity may start a forecast check."""
    if not forecast_refresh_events.enabled():
        raise HTTPException(status_code=503, detail="Event forecast refresh is disabled")
    _verify_task(request)
    try:
        return forecast_refresh_worker.check_refresh()
    except Exception as exc:
        # Cloud Tasks retries 5xx. A source write has already committed and is
        # recorded in SQL, so a worker failure must not erase that request.
        raise HTTPException(
            status_code=503,
            detail=f"Forecast refresh check failed: {type(exc).__name__}: {exc}",
        ) from exc
