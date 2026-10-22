import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import config  # noqa: F401

from app.middleware import UnhandledErrorMiddleware
from app.routers import sales, uploads, mappings, promotions, catalog, assistant, forecast, inventory, settings, notifications
from app.services import notification_service

logger = logging.getLogger("uvicorn.error")


def _delete_expired_notifications() -> None:
    # A database that is down must not stop the app from starting.
    try:
        deleted = notification_service.delete_expired()
        logger.info("Deleted %s expired notification(s)", deleted)
    except Exception as exc:
        logger.warning("Could not delete expired notifications: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Off the startup path, so the API is up before Cloud SQL answers.
    threading.Thread(target=_delete_expired_notifications, daemon=True).start()
    yield


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
