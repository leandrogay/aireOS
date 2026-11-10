from fastapi import APIRouter

from app.services import ai_models

# Whether each AI feature's Gemini model is still available, for the
# "AI unavailable" notices on the pages.
router = APIRouter(
    prefix="/api/ai-models",
    tags=["ai-models"],
)


@router.get("/status")
def get_status():
    """
    Per feature (`mapping`, `assistant`): `model`, `available`, and the
    `message` staff see while it is not. Never fails: the service reports every
    model available when it cannot read the notifications.
    """
    return ai_models.model_status()
