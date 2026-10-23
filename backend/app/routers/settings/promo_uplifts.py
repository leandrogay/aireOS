from fastapi import APIRouter, HTTPException, Response

from app.schemas.settings.promo_uplifts import (
    PromoAnchorReset,
    PromoAnchorUpdate,
    PromoUpliftOverrideCreate,
    PromoUpliftReset,
    PromoUpliftUpdate,
)
from app.services.settings import promo_uplifts as promo_uplift_service
from app.services.settings.common import CustomerNotFoundError


# Promotion Uplift Settings (uplift per mechanic, and each customer's
# ordinary-month discount) are under /api/settings/promo-uplifts (the
# /api/settings prefix comes from __init__.py)
router = APIRouter(
    prefix="/promo-uplifts",
    tags=["settings"],
)

_NOT_FOUND = (
    CustomerNotFoundError,
    promo_uplift_service.UpliftSettingNotFoundError,
    promo_uplift_service.MechanicNotFoundError,
)


def _version_status(response: Response, result: dict) -> dict:
    """201 when a new version was written, 200 when nothing changed (same as DOH settings)."""
    response.status_code = 201 if result["changed"] else 200
    return result


def _failed(action: str, e: Exception) -> HTTPException:
    return HTTPException(
        status_code=500,
        detail=f"Failed to {action}: {type(e).__name__}: {e}",
    )


# ============================================================
# MECHANIC UPLIFTS
# ============================================================


@router.get("")
def list_settings():
    try:
        return promo_uplift_service.list_settings()

    except Exception as e:
        raise _failed("retrieve promotion uplift settings", e)


@router.get("/resolved")
def resolve_uplifts(customer: str, product: str | None = None):
    try:
        return promo_uplift_service.resolve_uplifts(customer, product or None)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("resolve promotion uplifts", e)


@router.get("/match")
def match_mechanic(mechanic: str):
    try:
        return promo_uplift_service.match_mechanic(mechanic)

    except Exception as e:
        raise _failed("match the promotion mechanic", e)


@router.post("")
def add_override(body: PromoUpliftOverrideCreate, response: Response):
    try:
        result = promo_uplift_service.add_override(
            body.mechanic_key,
            body.scope,
            body.customer_id,
            body.uplift_pct,
            sku_range=body.sku_range,
            sku=body.sku,
            note=body.note,
            updated_by=body.updated_by,
        )
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("add the promotion uplift override", e)


@router.put("/{setting_id}")
def update_uplift(setting_id: int, body: PromoUpliftUpdate, response: Response):
    try:
        result = promo_uplift_service.update_uplift(
            setting_id,
            body.uplift_pct,
            note=body.note,
            updated_by=body.updated_by,
        )
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("save the promotion uplift", e)


@router.post("/{setting_id}/reset")
def reset_uplift(setting_id: int, response: Response, body: PromoUpliftReset | None = None):
    try:
        result = promo_uplift_service.reset_uplift(
            setting_id,
            body.updated_by if body is not None else None,
        )
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("reset the promotion uplift", e)


@router.get("/mechanics/{mechanic_key}/history")
def mechanic_history(mechanic_key: str):
    try:
        return promo_uplift_service.mechanic_history(mechanic_key)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the promotion uplift history", e)


# ============================================================
# ANCHORS (ordinary-month discount)
# ============================================================


@router.get("/anchors")
def list_anchors():
    try:
        return promo_uplift_service.list_anchors()

    except Exception as e:
        raise _failed("retrieve the ordinary-month discounts", e)


@router.put("/anchors/default")
def set_default_anchor(body: PromoAnchorUpdate, response: Response):
    try:
        result = promo_uplift_service.set_anchor(None, body.anchor_pct, body.updated_by)
        return _version_status(response, result)

    except Exception as e:
        raise _failed("save the all-customers ordinary-month discount", e)


@router.get("/anchors/{customer_id}")
def get_anchor(customer_id: int):
    try:
        return promo_uplift_service.get_anchor(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the ordinary-month discount", e)


@router.put("/anchors/{customer_id}")
def set_anchor(customer_id: int, body: PromoAnchorUpdate, response: Response):
    try:
        result = promo_uplift_service.set_anchor(customer_id, body.anchor_pct, body.updated_by)
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("save the ordinary-month discount", e)


@router.post("/anchors/{customer_id}/reset")
def reset_anchor(customer_id: int, response: Response, body: PromoAnchorReset | None = None):
    try:
        result = promo_uplift_service.reset_anchor(
            customer_id,
            body.updated_by if body is not None else None,
        )
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("reset the ordinary-month discount", e)


@router.get("/anchors/{customer_id}/history")
def anchor_history(customer_id: int):
    try:
        return promo_uplift_service.anchor_history(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the ordinary-month discount history", e)
