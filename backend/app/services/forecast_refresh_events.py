"""Record forecast input changes atomically and wake the delayed worker."""

import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import urlsplit

from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2
from google.protobuf import timestamp_pb2
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app import config

logger = logging.getLogger("uvicorn.error")
QUIET_SECONDS = 300


def enabled() -> bool:
    return config.FORECAST_REFRESH_ENABLED.strip().lower() in {"1", "true", "yes", "on"}


def record_change(conn: Connection, kind: str, source: str) -> int | None:
    """Add one outbox row in the caller's sales or promotion transaction."""
    if not enabled():
        return None
    if kind not in {"sales_upload", "promotion_change", "sku_change"} or not source:
        raise ValueError("Invalid forecast refresh source")
    return int(conn.execute(
        text("""
            INSERT INTO forecast_refresh_requests (kind, source)
            VALUES (:kind, :source)
            RETURNING id
        """),
        {"kind": kind, "source": source},
    ).scalar_one())


@lru_cache(maxsize=1)
def _tasks_client() -> tasks_v2.CloudTasksClient:
    return tasks_v2.CloudTasksClient()


def handler_audience() -> str:
    parsed = urlsplit(config.FORECAST_REFRESH_HANDLER_URL)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("FORECAST_REFRESH_HANDLER_URL must be an HTTPS Cloud Run URL")
    return f"{parsed.scheme}://{parsed.netloc}"


def enqueue_check(*, key: str, delay_seconds: int = QUIET_SECONDS) -> None:
    """Schedule an authenticated check; a stable key makes retries harmless."""
    project = config.require("GCP_PROJECT_ID")
    invoker = config.FORECAST_REFRESH_INVOKER
    url = config.FORECAST_REFRESH_HANDLER_URL
    if not invoker or not url:
        raise ValueError("Forecast refresh task URL and invoker must be configured")

    client = _tasks_client()
    parent = client.queue_path(project, config.FORECAST_REFRESH_LOCATION, config.FORECAST_REFRESH_QUEUE)
    schedule = timestamp_pb2.Timestamp()
    schedule.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=delay_seconds))
    task = {
        "name": f"{parent}/tasks/{key}",
        "schedule_time": schedule,
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": url,
            "oidc_token": {"service_account_email": invoker, "audience": handler_audience()},
        },
    }
    try:
        client.create_task(request={"parent": parent, "task": task})
    except AlreadyExists:
        pass


def enqueue_best_effort(request_id: int | None) -> None:
    """A saved upload/promotion must remain saved if task creation fails."""
    if request_id is None:
        return
    try:
        enqueue_check(key=f"forecast-change-{request_id}")
    except Exception as exc:
        logger.warning("Forecast change %s was recorded but not queued: %s", request_id, exc)
