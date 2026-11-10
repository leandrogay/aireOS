"""Cloud Tasks callback for event-driven forecast refresh."""

from fastapi import APIRouter, HTTPException, Request
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app import config
from app.services import forecast_refresh_events, forecast_refresh_worker

router = APIRouter(prefix="/internal/forecast", tags=["forecast"])


def _verify_task(request: Request, audience: str | None = None) -> None:
    # `audience`: another task handler's own Cloud Run URL (internal_promo).
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing task identity")
    try:
        claims = id_token.verify_oauth2_token(
            authorization[7:], GoogleRequest(), audience or forecast_refresh_events.handler_audience()
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid task identity") from exc
    if (
        claims.get("email") != config.FORECAST_REFRESH_INVOKER
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(status_code=403, detail="Task caller is not allowed")


def _max_attempts() -> int:
    # A bad value falls back to the queue's configured 10 rather than turning
    # every failed check into a "last attempt".
    try:
        attempts = int(config.FORECAST_REFRESH_MAX_ATTEMPTS)
    except (TypeError, ValueError):
        return 10
    return attempts if attempts > 0 else 10


def _is_last_attempt(request: Request) -> bool:
    # Cloud Tasks counts retries from 0, so the last of N attempts is retry N - 1.
    try:
        retry_count = int(request.headers.get("X-CloudTasks-TaskRetryCount", "0"))
    except ValueError:
        retry_count = 0
    return retry_count >= _max_attempts() - 1


@router.post("/refresh-check")
def refresh_check(request: Request):
    """Only the dedicated Cloud Tasks identity may start a forecast check."""
    if not forecast_refresh_events.enabled():
        raise HTTPException(status_code=503, detail="Event forecast refresh is disabled")
    _verify_task(request)
    try:
        return forecast_refresh_worker.check_refresh()
    except Exception as exc:
        if _is_last_attempt(request):
            forecast_refresh_worker.fail_unstarted_best_effort(
                f"Forecast refresh could not start after Cloud Tasks retries: {type(exc).__name__}: {exc}"
            )
        # Cloud Tasks retries 5xx. A source write has already committed and is
        # recorded in SQL, so a worker failure must not erase that request.
        raise HTTPException(
            status_code=503,
            detail=f"Forecast refresh check failed: {type(exc).__name__}: {exc}",
        ) from exc
