from fastapi import APIRouter, HTTPException

from app.schemas.notifications import MarkReadRequest
from app.services import notification_service

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
