from fastapi import APIRouter, HTTPException, Response
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError

from app.schemas.settings.promo_uplifts import (
    PromoAnchorReset,
    PromoAnchorUpdate,
    PromoMechanicCreate,
    PromoNoteDecision,
    PromoRuleReset,
    PromoRuleUpdate,
    PromoUpliftArchive,
    PromoUpliftOverrideCreate,
    PromoUpliftReset,
    PromoUpliftUpdate,
)
from app.services.settings import promo_measurement as measurement_service
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


_UPSTREAM_DETAIL = (
    "BigQuery could not be reached to read the sales history; check the service "
    "account's BigQuery access and try again."
)


# ============================================================
# MEASUREMENT (before the /{setting_id} routes)
# ============================================================


@router.post("/measure")
def run_measurement():
    try:
        return measurement_service.run_measurement("button")

    except measurement_service.MeasurementRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except (DefaultCredentialsError, GoogleAPICallError):
        raise HTTPException(status_code=503, detail=_UPSTREAM_DETAIL)

    except Exception as e:
        raise _failed("measure the promotion uplifts", e)


@router.get("/measure/status")
def measurement_status():
    try:
        return measurement_service.measurement_status()

    except Exception as e:
        raise _failed("retrieve the measurement status", e)


@router.get("/notes")
def list_notes():
    try:
        return measurement_service.list_notes()

    except Exception as e:
        raise _failed("retrieve the measurement notes", e)


def _decide_note(action, note_id: int, body: PromoNoteDecision | None, verb: str):
    try:
        return action(note_id, body.updated_by if body is not None else None)

    except measurement_service.NoteNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except (measurement_service.NoteConflictError, promo_uplift_service.UpliftSettingConflictError) as e:
        raise HTTPException(status_code=409, detail=str(e))

    except promo_uplift_service.UpliftSettingNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed(verb, e)


@router.post("/notes/{note_id}/use-measured")
def use_measured(note_id: int, body: PromoNoteDecision | None = None):
    return _decide_note(measurement_service.use_measured, note_id, body, "use the measured value")


@router.post("/notes/{note_id}/keep-mine")
def keep_mine(note_id: int, body: PromoNoteDecision | None = None):
    return _decide_note(measurement_service.keep_mine, note_id, body, "keep the typed value")


@router.post("/mechanics")
def add_mechanic(body: PromoMechanicCreate, response: Response):
    try:
        result = promo_uplift_service.add_mechanic(
            body.kind,
            body.mechanic_label,
            effective_discount_pct=body.effective_discount_pct,
            uplift_pct=body.uplift_pct,
            note=body.note,
            updated_by=body.updated_by,
        )
        return _version_status(response, result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("add the mechanic", e)


# ============================================================
# THE RULE (rate behind rule-based uplifts)
# ============================================================


@router.get("/rule")
def get_rule():
    try:
        return promo_uplift_service.get_rule()

    except Exception as e:
        raise _failed("retrieve the rule", e)


@router.put("/rule")
def set_rule(body: PromoRuleUpdate, response: Response):
    try:
        result = promo_uplift_service.set_rule(body.uplift_per_point_pct, body.updated_by)
        return _version_status(response, result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise _failed("save the rule", e)


@router.post("/rule/reset")
def reset_rule(response: Response, body: PromoRuleReset | None = None):
    try:
        result = promo_uplift_service.reset_rule(body.updated_by if body is not None else None)
        return _version_status(response, result)

    except Exception as e:
        raise _failed("reset the rule", e)


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


@router.post("/{setting_id}/archive")
def archive_uplift(setting_id: int, response: Response, body: PromoUpliftArchive | None = None):
    try:
        result = promo_uplift_service.archive_uplift(setting_id, body.updated_by if body is not None else None)
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("archive the promotion uplift", e)


@router.post("/{setting_id}/restore")
def restore_uplift(setting_id: int, response: Response, body: PromoUpliftArchive | None = None):
    try:
        result = promo_uplift_service.restore_uplift(setting_id, body.updated_by if body is not None else None)
        return _version_status(response, result)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except promo_uplift_service.UpliftSettingConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except Exception as e:
        raise _failed("restore the promotion uplift", e)


@router.get("/{setting_id}/evidence")
def uplift_evidence(setting_id: int):
    try:
        return measurement_service.evidence(setting_id)

    except _NOT_FOUND as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise _failed("retrieve the evidence", e)


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
