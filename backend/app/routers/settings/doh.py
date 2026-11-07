from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import current_user_email

from app.schemas.settings.doh import DohAlertUpdate, DohThresholdsUpdate
from app.services.settings import doh as doh_service
from app.services.settings.common import CustomerNotFoundError


# Per-customer DOH thresholds (versioned) and alert toggle are under
# /api/settings/doh (the /api/settings prefix comes from __init__.py).
# A new version records the signed-in user's email as updated_by, never a
# name sent in the body.
router = APIRouter(
    prefix="/doh",
    tags=["settings"],
)


def _version_status(response: Response, result: dict) -> dict:
    """201 when a new threshold version was written, 200 when the values were unchanged."""
    response.status_code = 201 if result["changed"] else 200
    return result


# ============================================================
# CURRENT SETTINGS
# ============================================================


@router.get("")
def list_settings():
    try:
        return doh_service.list_settings()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve DOH settings: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/{customer_id}")
def get_settings(customer_id: int):
    try:
        return doh_service.get_settings(customer_id)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve the DOH settings: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# THRESHOLD VERSIONS
# ============================================================


@router.put("/{customer_id}/thresholds")
def save_thresholds(
    customer_id: int,
    update: DohThresholdsUpdate,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = doh_service.save_thresholds(
            customer_id,
            update.min_doh,
            update.target_doh,
            update.max_doh,
            updated_by,
        )
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to save DOH thresholds: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/{customer_id}/history")
def get_history(
    customer_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    try:
        return doh_service.get_history(customer_id, limit=limit, offset=offset)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve the DOH threshold history: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.post("/{customer_id}/history/{setting_id}/revert")
def revert_to_version(
    customer_id: int,
    setting_id: int,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = doh_service.revert_to_version(
            customer_id,
            setting_id,
            updated_by,
        )
        return _version_status(response, result)

    except (
        CustomerNotFoundError,
        doh_service.SettingVersionNotFoundError,
    ) as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to revert the DOH thresholds: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.post("/{customer_id}/reset")
def reset_to_default(
    customer_id: int,
    response: Response,
    updated_by: str = Depends(current_user_email),
):
    try:
        result = doh_service.reset_to_default(
            customer_id,
            updated_by,
        )
        return _version_status(response, result)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to reset the DOH thresholds: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# DOH ALERT
# ============================================================


@router.put("/{customer_id}/alert")
def set_alert(customer_id: int, update: DohAlertUpdate):
    try:
        return doh_service.set_alert(customer_id, update.doh_alert_enabled)

    except CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update the DOH alert: "
                f"{type(e).__name__}: {e}"
            ),
        )
