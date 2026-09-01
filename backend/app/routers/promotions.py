from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import promotion_service
from app.schemas.promotions import (
    PromotionCreate,
    PromotionUpdate,
    RetailerCreate,
    RetailerUpdate,
    StoreCreate,
    StoreUpdate,
)


router = APIRouter(
    prefix="/api/promotions",
    tags=["promotions"],
)

@router.get("/health/db")
def check_db_connection():
    try:
        result = promotion_service.check_db_connection()

        return {
            "status": "ok",
            "db_reachable": True,
            "result": result,
        }

    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Database connection failed: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# RETAILER CRUD
#
# These routes MUST stay above /{promotion_id}.
# ============================================================


@router.post("/retailers", status_code=201)
def create_retailer(
    retailer: RetailerCreate,
):
    try:
        return promotion_service.create_retailer(
            retailer
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "A retailer with this name already exists."
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/retailers")
def get_retailers():
    try:
        return promotion_service.get_retailers()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve retailers: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/retailers/{retailer_id}")
def get_retailer(
    retailer_id: int,
):
    try:
        retailer = promotion_service.get_retailer(
            retailer_id
        )

        if retailer is None:
            raise HTTPException(
                status_code=404,
                detail="Retailer not found",
            )

        return retailer

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/retailers/{retailer_id}")
def update_retailer(
    retailer_id: int,
    retailer: RetailerUpdate,
):
    try:
        updated = promotion_service.update_retailer(
            retailer_id,
            retailer,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Retailer not found",
            )

        return updated

    except HTTPException:
        raise

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "A retailer with this name already exists."
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.delete("/retailers/{retailer_id}")
def delete_retailer(
    retailer_id: int,
):
    try:
        deleted = promotion_service.delete_retailer(
            retailer_id
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Retailer not found",
            )

        return {
            "status": "ok",
            "message": "Retailer deleted successfully",
            "retailer_id": retailer_id,
        }

    except promotion_service.RetailerHasStoresError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to delete retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# STORE CRUD
#
# These routes MUST also stay above /{promotion_id}.
# ============================================================


@router.post("/stores", status_code=201)
def create_store(
    store: StoreCreate,
):
    try:
        return promotion_service.create_store(
            store
        )

    except promotion_service.RetailerNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "A store with this store code already exists "
                "under this retailer."
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create store: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/stores")
def get_stores(
    retailer_id: int | None = None,
):
    try:
        return promotion_service.get_stores(
            retailer_id=retailer_id
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve stores: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/stores/{store_id}")
def get_store(
    store_id: int,
):
    try:
        store = promotion_service.get_store(
            store_id
        )

        if store is None:
            raise HTTPException(
                status_code=404,
                detail="Store not found",
            )

        return store

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve store: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/stores/{store_id}")
def update_store(
    store_id: int,
    store: StoreUpdate,
):
    try:
        updated = promotion_service.update_store(
            store_id,
            store,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Store not found",
            )

        return updated

    except promotion_service.RetailerNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e),
        )

    except HTTPException:
        raise

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "A store with this store code already exists "
                "under this retailer."
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update store: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.delete("/stores/{store_id}")
def delete_store(
    store_id: int,
):
    try:
        deleted = promotion_service.delete_store(
            store_id
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Store not found",
            )

        return {
            "status": "ok",
            "message": "Store deleted successfully",
            "store_id": store_id,
        }

    except promotion_service.StoreHasPromotionsError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to delete store: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION CREATE
# ============================================================


@router.post("", status_code=201)
def create_promotion(
    promotion: PromotionCreate,
):
    try:
        return promotion_service.create_promotion(
            promotion
        )

    except IntegrityError as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Database constraint error: {e.orig}"
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create promotion: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION READ ALL
# ============================================================


@router.get("")
def get_promotions():
    try:
        return promotion_service.get_promotions()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve promotions: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION READ ONE
#
# Keep dynamic promotion routes LAST so /retailers and /stores
# are not mistaken for promotion IDs.
# ============================================================


@router.get("/{promotion_id}")
def get_promotion(
    promotion_id: int,
):
    try:
        promotion = promotion_service.get_promotion(
            promotion_id
        )

        if promotion is None:
            raise HTTPException(
                status_code=404,
                detail="Promotion not found",
            )

        return promotion

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve promotion: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION UPDATE
# ============================================================


@router.put("/{promotion_id}")
def update_promotion(
    promotion_id: int,
    promotion: PromotionUpdate,
):
    try:
        updated = promotion_service.update_promotion(
            promotion_id,
            promotion,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Promotion not found",
            )

        return updated

    except HTTPException:
        raise

    except IntegrityError as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Database constraint error: {e.orig}"
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update promotion: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION DELETE
# ============================================================


@router.delete("/{promotion_id}")
def delete_promotion(
    promotion_id: int,
):
    try:
        deleted = promotion_service.delete_promotion(
            promotion_id
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Promotion not found",
            )

        return {
            "status": "ok",
            "message": "Promotion deleted successfully",
            "promotion_id": promotion_id,
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to delete promotion: "
                f"{type(e).__name__}: {e}"
            ),
        )