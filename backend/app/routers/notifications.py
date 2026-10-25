import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app import notification_stream
from app.schemas.notifications import MarkReadRequest
from app.services import notification_service

# A comment line this often keeps proxies from closing a quiet stream.
_KEEP_ALIVE_SECONDS = 25

# One shared notification feed (no per-user accounts) under /api/notifications
router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
)


@router.get("")
def list_notifications(unread_only: bool = False, limit: int = 50):
    try:
        return notification_service.list_notifications(unread_only=unread_only, limit=limit)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list notifications: {type(e).__name__}: {e}",
        )


@router.get("/stream")
async def stream_changes(request: Request):
    """
    Server-Sent Events: a `changed` event whenever any notification is added,
    read or deleted, so a tab re-fetches only then instead of polling. The
    browser's EventSource reconnects by itself (after `retry` ms) if this drops.
    """

    async def events():
        queue = notification_stream.subscribe()
        try:
            yield "retry: 5000\n\n"
            while not await request.is_disconnected():
                try:
                    await asyncio.wait_for(queue.get(), timeout=_KEEP_ALIVE_SECONDS)
                    yield "event: changed\ndata: {}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            notification_stream.unsubscribe(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/unread-count")
def get_unread_count():
    try:
        return {"unread_count": notification_service.unread_count()}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to count unread notifications: {type(e).__name__}: {e}",
        )


@router.post("/mark-read")
def mark_read(update: MarkReadRequest):
    try:
        return {"marked_read": notification_service.mark_read(update.notification_ids)}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to mark notifications read: {type(e).__name__}: {e}",
        )
