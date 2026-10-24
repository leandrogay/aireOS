"""
Pushes "the notifications changed" to every open browser tab, instead of each
tab polling.

One background task holds a dedicated Postgres connection that LISTENs on
notification_service.NOTIFY_CHANNEL. Every insert, mark-read and expiry
cleanup sends a NOTIFY on it from whichever process made the change (this API,
scripts/refresh_forecast.py, the scheduled-forecast listener), so this hears
about all of them. Each open GET /api/notifications/stream holds a queue here;
a NOTIFY wakes every queue and each tab re-fetches the list.

Async, unlike the services: asyncpg's listener is what lets the connection
wait for a NOTIFY without polling, which pg8000 (the services' driver) cannot.
"""

import asyncio
import logging

from google.cloud.sql.connector import IPTypes, create_async_connector
from google.oauth2 import service_account

from app import config
from app.services import notification_service

logger = logging.getLogger("uvicorn.error")

# A quiet connection is checked this often, so one silently dropped by the
# network is noticed and replaced instead of waiting forever.
_HEALTH_CHECK_SECONDS = 30
_RETRY_SECONDS = 15

_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    # maxsize=1: several changes in a row need only one re-fetch.
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    _subscribers.add(queue)
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.discard(queue)


def broadcast() -> None:
    for queue in list(_subscribers):
        if queue.empty():
            queue.put_nowait(True)


async def _connect(connector):
    return await connector.connect_async(
        config.require("POSTGRESQL_INSTANCE_CONNECTION_NAME"),
        "asyncpg",
        user=config.require("DB_IAM_USER"),
        db=config.require("DB_NAME"),
        ip_type=IPTypes.PUBLIC,
        enable_iam_auth=True,
    )


async def run_listener(stop: asyncio.Event) -> None:
    """LISTENs until `stop` is set, reconnecting after any failure."""

    connector = None
    while not stop.is_set():
        conn = None
        try:
            if connector is None:
                credentials = service_account.Credentials.from_service_account_file(
                    config.require_file("GOOGLE_APPLICATION_CREDENTIALS"),
                    scopes=["https://www.googleapis.com/auth/sqlservice.admin"],
                )
                connector = await create_async_connector(credentials=credentials, refresh_strategy="LAZY")
            conn = await _connect(connector)
            await conn.add_listener(notification_service.NOTIFY_CHANNEL, lambda *_args: broadcast())
            logger.info("Listening for notification changes")
            # Anything that changed while there was no connection.
            broadcast()
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=_HEALTH_CHECK_SECONDS)
                except asyncio.TimeoutError:
                    await conn.execute("SELECT 1")
        except Exception as exc:
            logger.warning("Notification listener stopped (%s); retrying in %ss", exc, _RETRY_SECONDS)
            try:
                await asyncio.wait_for(stop.wait(), timeout=_RETRY_SECONDS)
            except asyncio.TimeoutError:
                pass
        finally:
            if conn is not None and not conn.is_closed():
                await conn.close()
    if connector is not None:
        await connector.close_async()
