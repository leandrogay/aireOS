from datetime import date

from fastapi import APIRouter, HTTPException, Query
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError

from app.schemas.inventory import (
    DohThresholdUpdate,
    InventoryRecordCreate,
    InventoryRecordUpdate,
    ShippedSoFarUpdate,
)
from app.services import inventory_service


# Inventory views, records and DOH thresholds are under /api/inventory
router = APIRouter(
    prefix="/api/inventory",
    tags=["inventory"],
)

_CREDENTIALS_DETAIL = (
    "BigQuery credentials are not configured. Set "
    "GOOGLE_APPLICATION_CREDENTIALS in backend/.env.backend to a service "
    "account key with BigQuery Data Viewer + Job User access."
)


def _first_of_month(value: date | None) -> date | None:
    """Query dates are any day of the month; the service works in whole months."""
    return value.replace(day=1) if value is not None else None


# ============================================================
# CUSTOMERS AND SKUS
# ============================================================


@router.get("/customers")
def get_customers():
    try:
        return inventory_service.list_customers()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve customers: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/skus")
def get_skus():
    try:
        return inventory_service.list_skus()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve SKUs: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# OVERVIEW (all customers) AND CUSTOMER VIEW
# ============================================================


@router.get("/overview")
def get_overview(
    customer_id: list[int] | None = Query(default=None),
    sku: list[str] | None = Query(default=None),
    start_month: date | None = None,
    end_month: date | None = None,
):
    try:
        return inventory_service.get_overview(
            customer_ids=customer_id,
            skus=sku,
            start_month=_first_of_month(start_month),
            end_month=_first_of_month(end_month),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve the inventory overview: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/customers/{customer_id}")
def get_customer_view(
    customer_id: int,
    sku: list[str] | None = Query(default=None),
    start_month: date | None = None,
    end_month: date | None = None,
):
    try:
        return inventory_service.get_customer_view(
            customer_id,
            skus=sku,
            start_month=_first_of_month(start_month),
            end_month=_first_of_month(end_month),
        )

    except inventory_service.CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)

    except GoogleAPICallError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to reach BigQuery for the forecast: {e.message}",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve the customer's inventory: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/customers/{customer_id}/sell-in-plan")
def get_sell_in_plan(
    customer_id: int,
    months: int = Query(default=6, ge=1, le=12),
):
    try:
        return inventory_service.get_sell_in_plan(customer_id, months=months)

    except inventory_service.CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)

    except GoogleAPICallError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to reach BigQuery for the forecast: {e.message}",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to build the sell-in plan: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# CREATE / EDIT INVENTORY DATA
# ============================================================


@router.post("/records", status_code=201)
def create_records(record: InventoryRecordCreate):
    try:
        return inventory_service.create_records(record)

    except (
        inventory_service.CustomerNotFoundError,
        inventory_service.SkuNotFoundError,
    ) as e:
        raise HTTPException(status_code=404, detail=str(e))

    except inventory_service.InventoryConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create inventory data: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/records")
def update_records(record: InventoryRecordUpdate):
    try:
        return inventory_service.update_records(record)

    except (
        inventory_service.CustomerNotFoundError,
        inventory_service.SkuNotFoundError,
        inventory_service.InventoryNotFoundError,
    ) as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update inventory data: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/shipped-so-far")
def set_shipped_so_far(update: ShippedSoFarUpdate):
    try:
        return inventory_service.set_shipped_so_far(update)

    except (
        inventory_service.CustomerNotFoundError,
        inventory_service.SkuNotFoundError,
    ) as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to save shipped so far: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# DOH THRESHOLDS
# ============================================================


@router.get("/doh-thresholds")
def get_doh_thresholds():
    try:
        return inventory_service.get_doh_thresholds()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve DOH thresholds: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/doh-thresholds")
def set_doh_thresholds(update: DohThresholdUpdate):
    try:
        return inventory_service.set_doh_thresholds(
            update.customer_ids,
            update.target_doh,
        )

    except inventory_service.CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update DOH thresholds: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.delete("/doh-thresholds/{customer_id}")
def reset_doh_threshold(customer_id: int):
    try:
        return inventory_service.reset_doh_threshold(customer_id)

    except inventory_service.CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to reset the DOH threshold: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/doh-thresholds/{customer_id}/history")
def get_doh_history(customer_id: int):
    try:
        return inventory_service.get_doh_history(customer_id)

    except inventory_service.CustomerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve the DOH threshold history: "
                f"{type(e).__name__}: {e}"
            ),
        )
