import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import config

from app.middleware import UnhandledErrorMiddleware
from app.routers import sales, uploads, mappings, promotions, catalog, assistant, forecast, inventory, settings, notifications
from app import notification_stream
from app.services import forecast_pipeline_events, notification_service

logger = logging.getLogger("uvicorn.error")


def _delete_expired_notifications() -> None:
    # A database that is down must not stop the app or end the cleanup loop.
    try:
        deleted = notification_service.delete_expired()
        logger.info("Deleted %s expired notification(s)", deleted)
    except Exception as exc:
        logger.warning("Could not delete expired notifications: %s", exc)


def _cleanup_loop(stop: threading.Event, interval_seconds: float) -> None:
    """Deletes expired notifications now, then every `interval_seconds` until `stop` is set."""

    while True:
        _delete_expired_notifications()
        if stop.wait(interval_seconds):
            return


def _start_forecast_run_listener():
    # Pub/Sub being unreachable must not stop the app from starting.
    try:
        return forecast_pipeline_events.start_listening()
    except Exception as exc:
        logger.warning("Not listening for scheduled forecast runs: %s", exc)
        return None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # All in the background, so the API is up before Cloud SQL or Pub/Sub answers.
    stop_cleanup = threading.Event()
    interval_seconds = config.NOTIFICATION_CLEANUP_INTERVAL_HOURS * 3600
    threading.Thread(target=_cleanup_loop, args=(stop_cleanup, interval_seconds), daemon=True).start()

    stop_listening = asyncio.Event()
    listener = asyncio.create_task(notification_stream.run_listener(stop_listening))
    forecast_runs = _start_forecast_run_listener()

    yield

    stop_cleanup.set()
    stop_listening.set()
    if forecast_runs is not None:
        forecast_runs.cancel()
    await listener


app = FastAPI(lifespan=lifespan)

# origins = ["http://localhost:3000"] # Frontend location

# Registered before CORSMiddleware so it ends up inside it -- see the
# docstring above for why the order matters.
app.add_middleware(UnhandledErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    # allow_origins=origins,
    allow_origin_regex=".*",   # dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(uploads.router)
app.include_router(mappings.router)
app.include_router(sales.router)
app.include_router(catalog.router)
app.include_router(promotions.router)
app.include_router(assistant.router)
app.include_router(forecast.router)
app.include_router(inventory.router)
app.include_router(settings.router)
app.include_router(notifications.router)


@app.get("/")
def read_root():
    return {"status": "ok"}
