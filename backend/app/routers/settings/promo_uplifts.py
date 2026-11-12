from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_email

from app.schemas.settings.promo_uplifts import (
    MechanicDiscountUpdate,
    PromoAnchorAdopt,
    PromoAnchorOverwrite,
    PromoFallbackAnchorUpdate,
)
from app.services.settings import promo_moments as promo_moment_service
from app.services.settings import promo_recalc as promo_recalc_service
from app.services.settings import promo_uplift_calc as promo_uplift_calc_service
from app.services.settings import promo_uplifts as promo_uplift_service
from app.services.settings.common import CustomerNotFoundError


# Promotion Uplift Settings (uplift per mechanic, and each customer's
# ordinary-month discount) are under /api/settings/promo-uplifts (the
# /api/settings prefix comes from __init__.py). Every write records the
# signed-in user's email as updated_by, never a name sent in the body.
router = APIRouter(
    prefix="/promo-uplifts",
    tags=["settings"],
)

_NOT_FOUND = (
    CustomerNotFoundError,
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
def resolve_uplifts(customer: str, product: str | None = None, sku_range: str | None = None):
    try:
        return promo_uplift_service.resolve_uplifts(customer, product or None, sku_range or None)

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


@router.get("/moments")
def list_moments():
    try:
        return promo_moment_service.list_moments()

    except Exception as e:
        raise _failed("retrieve promotion moments", e)


@router.post("/recalculate")
def recalculate(customer_id: int | None = None):
    """Work out one customer's moments and uplifts now (no customer_id = every customer)."""

    try:
        return promo_recalc_service.recalculate(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("recalculate promotion moments and uplifts", e)


@router.get("/calculated")
def list_calculated(customer_id: int | None = None):
    """The worked-out uplift per customer x SKU range x mechanic, with its anchor versions and SKUs."""

    try:
        return promo_uplift_calc_service.list_calculated(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the calculated promotion uplifts", e)


@router.put("/mechanics/{mechanic_key}")
def set_mechanic_discount(
    mechanic_key: str,
    body: MechanicDiscountUpdate,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = promo_uplift_service.set_mechanic_discount(
            mechanic_key,
            body.effective_discount_pct,
            note=body.note,
            updated_by=updated_by,
        )
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("save the mechanic's discount", e)


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


# The fallback anchor's routes come before /anchors/{customer_id}, which
# would otherwise take "default" as a customer id.
@router.put("/anchors/default")
def set_fallback_anchor(
    body: PromoFallbackAnchorUpdate,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = promo_uplift_service.set_fallback_anchor(body.anchor_pct, updated_by)
        return _version_status(response, result)

    except Exception as e:
        raise _failed("save the fallback ordinary-month discount", e)


@router.get("/anchors/default/history")
def fallback_anchor_history():
    try:
        return promo_uplift_service.anchor_history(None)

    except Exception as e:
        raise _failed("retrieve the fallback ordinary-month discount history", e)


@router.get("/anchors/{customer_id}")
def get_anchor(customer_id: int):
    try:
        return promo_uplift_service.get_anchor(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the ordinary-month discount", e)


@router.put("/anchors/{customer_id}")
def overwrite_anchor(
    customer_id: int,
    body: PromoAnchorOverwrite,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = promo_uplift_service.overwrite_anchor(customer_id, body.mechanic_key, body.sku_range, updated_by)
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise _failed("save the ordinary-month discount", e)


@router.post("/anchors/{customer_id}/adopt")
def adopt_anchor(
    customer_id: int,
    response: Response,
    body: PromoAnchorAdopt | None = None,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = promo_uplift_service.adopt_anchor(
            customer_id,
            body.sku_range if body is not None else None,
            updated_by,
        )
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("adopt the recommended anchor", e)


@router.get("/anchors/{customer_id}/history")
def anchor_history(customer_id: int, sku_range: str | None = None):
    try:
        return promo_uplift_service.anchor_history(customer_id, sku_range)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the ordinary-month discount history", e)
