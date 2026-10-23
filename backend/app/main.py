import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import config  # noqa: F401  (loads .env.backend before anything reads settings)

from app.middleware import UnhandledErrorMiddleware
from app.routers import sales, uploads, mappings, promotions, catalog, assistant, forecast, inventory, settings, notifications
from app import notification_stream
from app.services import forecast_pipeline_events

logger = logging.getLogger("uvicorn.error")


def _start_forecast_run_listener():
    # Pub/Sub being unreachable must not stop the app from starting.
    try:
        return forecast_pipeline_events.start_listening()
    except Exception as exc:
        logger.warning("Not listening for scheduled forecast runs: %s", exc)
        return None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # In the background, so the API is up before Cloud SQL or Pub/Sub answers.
    stop_listening = asyncio.Event()
    listener = asyncio.create_task(notification_stream.run_listener(stop_listening))
    forecast_runs = _start_forecast_run_listener()

    yield

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
