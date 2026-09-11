from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import catalog_service
from app.schemas.catalog import (
    RetailerCreate,
    RetailerUpdate,
    StoreCreate,
    StoreUpdate,
)


# Retailers and stores are under /api/catalog
router = APIRouter(
    prefix="/api/catalog",
    tags=["catalog"],
)


# ============================================================
# RETAILER CRUD
# ============================================================


@router.post("/retailers", status_code=201)
def create_retailer(retailer: RetailerCreate):
    try:
        return catalog_service.create_retailer(
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
        return catalog_service.get_retailers()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve retailers: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.get("/retailers/{retailer_id}")
def get_retailer(retailer_id: int):
    try:
        retailer = catalog_service.get_retailer(
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
def update_retailer(retailer_id: int, retailer: RetailerUpdate):
    try:
        updated = catalog_service.update_retailer(
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
def delete_retailer(retailer_id: int):
    try:
        deleted = catalog_service.delete_retailer(
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

    except catalog_service.RetailerHasStoresError as e:
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
# ============================================================


@router.post("/stores", status_code=201)
def create_store(store: StoreCreate):
    try:
        return catalog_service.create_store(
            store
        )

    except catalog_service.RetailerNotFoundError as e:
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
def get_stores(retailer_id: int | None = None):
    try:
        return catalog_service.get_stores(
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
def get_store(store_id: int):
    try:
        store = catalog_service.get_store(
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
def update_store(store_id: int, store: StoreUpdate):
    try:
        updated = catalog_service.update_store(
            store_id,
            store,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Store not found",
            )

        return updated

    except catalog_service.RetailerNotFoundError as e:
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
def delete_store(store_id: int):
    try:
        deleted = catalog_service.delete_store(
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

    except catalog_service.StoreHasPromotionsError as e:
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
# SKU RANGE LOOKUPS
# ============================================================


@router.get("/sku-ranges")
def get_sku_ranges():
    try:
        return catalog_service.get_sku_ranges()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve sku ranges: "
                f"{type(e).__name__}: {e}"
            ),
        )
