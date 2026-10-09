from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import catalog_service, customer_service
from app.services.settings.common import CustomerNotFoundError
from app.schemas.catalog import (
    CustomerCreate,
    CustomerUpdate,
    RetailerCreate,
    RetailerLink,
    RetailerUpdate,
    StoreCreate,
    StoreUpdate,
)


# Customers, retailers and stores are under /api/catalog
router = APIRouter(
    prefix="/api/catalog",
    tags=["catalog"],
)


# ============================================================
# CUSTOMER CRUD
#
# The Customers page: customers and the retailers under them.
# A name clash, or a customer that already has data, is a 409
# with a sentence the page shows as is. IntegrityError is the
# backstop for a race past the service's own checks.
# ============================================================


_CUSTOMER_NAME_TAKEN = "A customer with this name already exists."
_RETAILER_NAME_TAKEN = "A retailer with this name already exists."


@router.get("/customers")
def get_customers():
    try:
        return customer_service.list_customers()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve customers: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.post("/customers", status_code=201)
def create_customer(customer: CustomerCreate):
    try:
        return customer_service.create_customer(
            customer
        )

    except customer_service.CustomerNameTakenError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=_CUSTOMER_NAME_TAKEN,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create customer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/customers/{customer_id}")
def update_customer(customer_id: int, customer: CustomerUpdate):
    try:
        updated = customer_service.update_customer(
            customer_id,
            customer,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Customer not found",
            )

        return updated

    except HTTPException:
        raise

    except (
        customer_service.CustomerNameTakenError,
        customer_service.CustomerInUseError,
    ) as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=_CUSTOMER_NAME_TAKEN,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update customer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: int):
    try:
        deleted = customer_service.delete_customer(
            customer_id
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Customer not found",
            )

        return {
            "status": "ok",
            "message": "Customer deleted successfully",
            "customer_id": customer_id,
        }

    except HTTPException:
        raise

    except (
        customer_service.CustomerInUseError,
        customer_service.CustomerHasRetailersError,
    ) as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "This customer is still referenced by other data, "
                "so it can't be deleted."
            ),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to delete customer: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# RETAILER CRUD
#
# Writes answer with { retailer, customer }: the retailer and its
# parent customer row (null for a retailer no customer owns yet).
# ============================================================


@router.post("/retailers", status_code=201)
def create_retailer(retailer: RetailerCreate):
    try:
        return catalog_service.create_retailer(
            retailer
        )

    except CustomerNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e),
        )

    except catalog_service.RetailerNameTakenError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=_RETAILER_NAME_TAKEN,
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

    except (
        catalog_service.RetailerNameTakenError,
        catalog_service.RetailerHasStoresError,
    ) as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=_RETAILER_NAME_TAKEN,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to update retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.put("/retailers/{retailer_id}/customer")
def link_retailer(retailer_id: int, link: RetailerLink):
    try:
        linked = catalog_service.link_retailer(
            retailer_id,
            link.customer_id,
        )

        if linked is None:
            raise HTTPException(
                status_code=404,
                detail="Retailer not found",
            )

        return linked

    except HTTPException:
        raise

    except CustomerNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e),
        )

    except catalog_service.RetailerAlreadyLinkedError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="This retailer already belongs to a customer.",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to link retailer: "
                f"{type(e).__name__}: {e}"
            ),
        )


@router.delete("/retailers/{retailer_id}")
def delete_retailer(retailer_id: int):
    try:
        deleted = catalog_service.delete_retailer(
            retailer_id
        )

        if deleted is None:
            raise HTTPException(
                status_code=404,
                detail="Retailer not found",
            )

        return {
            "status": "ok",
            "message": "Retailer deleted successfully",
            "retailer_id": retailer_id,
            "customer": deleted["customer"],
        }

    except catalog_service.RetailerHasStoresError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except HTTPException:
        raise

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=(
                "This retailer is still referenced by other data, "
                "so it can't be deleted."
            ),
        )

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
