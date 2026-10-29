import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config, notification_stream
from app.auth import require_user
from app.middleware import UnhandledErrorMiddleware
from app.routers import assistant, auth, catalog, forecast, inventory, mappings
from app.routers import notifications, promotions, sales, scenario, settings, uploads
from app.services import forecast_pipeline_events

logger = logging.getLogger("uvicorn.error")


def _cors_origins() -> list[str]:
    # The SSO frontend must always be allowed, even if CORS_ALLOWED_ORIGINS
    # was left at its local-dev default.
    origins = list(config.CORS_ALLOWED_ORIGINS)
    frontend = config.AUTH_FRONTEND_URL.rstrip("/")
    if config.auth_enabled() and frontend not in origins:
        origins.append(frontend)
    return origins


def _start_forecast_run_listener():
    # Pub/Sub being unreachable must not stop the app from starting.
    try:
        return forecast_pipeline_events.start_listening()
    except Exception as exc:
        logger.warning("Not listening for scheduled forecast runs: %s", exc)
        return None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Run notification listeners in the background so the API can start first.
    stop_listening = asyncio.Event()
    listener = asyncio.create_task(
        notification_stream.run_listener(stop_listening)
    )
    forecast_runs = _start_forecast_run_listener()

    yield

    stop_listening.set()
    if forecast_runs is not None:
        forecast_runs.cancel()
    await listener


app = FastAPI(lifespan=lifespan)

# Registered before CORSMiddleware so unhandled errors still receive the
# appropriate CORS headers.
app.add_middleware(UnhandledErrorMiddleware)

# Only the listed origins (config.CORS_ALLOWED_ORIGINS) may call the API from
# a browser. Credentials are allowed, so this must stay an explicit list --
# never a wildcard or a catch-all regex.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

protected = [Depends(require_user)]

# Authentication endpoints must remain public so users can log in.
app.include_router(auth.router)

# All internal application endpoints require a valid session when enabled.
app.include_router(uploads.router, dependencies=protected)
app.include_router(mappings.router, dependencies=protected)
app.include_router(sales.router, dependencies=protected)
app.include_router(catalog.router, dependencies=protected)
app.include_router(promotions.router, dependencies=protected)
app.include_router(assistant.router, dependencies=protected)
app.include_router(forecast.router, dependencies=protected)
app.include_router(inventory.router, dependencies=protected)
app.include_router(settings.router, dependencies=protected)
app.include_router(notifications.router, dependencies=protected)
app.include_router(scenario.router, dependencies=protected)

@app.get("/")
def read_root():
    return {"status": "ok"}