"""Cloud Tasks callback for the promotion moments and uplifts recalculation."""

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError

from app import config
from app.routers.internal_forecast import _verify_task
from app.services import forecast_refresh_events
from app.services.settings import promo_recalc, promo_recalc_events


# Woken by promo_recalc_events.enqueue_best_effort after a save; only the
# Cloud Tasks identity of the forecast refresh may call it.
router = APIRouter(prefix="/internal/promo", tags=["settings"])


@router.post("/recalc")
def recalc(request: Request):
    if not promo_recalc_events.enabled() or not config.PROMO_RECALC_HANDLER_URL:
        raise HTTPException(status_code=503, detail="Promo recalculation tasks are disabled")
    _verify_task(request, forecast_refresh_events.handler_audience(config.PROMO_RECALC_HANDLER_URL))

    try:
        return promo_recalc.process_pending()

    except SQLAlchemyError as e:
        # Cloud Tasks retries a 5xx; the requests are still in the table.
        raise HTTPException(status_code=503, detail=f"Promo recalculation failed: {type(e).__name__}: {e}") from e
