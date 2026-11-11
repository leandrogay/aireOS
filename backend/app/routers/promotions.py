from fastapi import APIRouter, HTTPException, Query
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.services import promotion_pricing, promotion_service
from app.schemas.promotions import (
    PromotionCreate,
    PromotionUpdate,
    RevenueEstimateRequest,
)


router = APIRouter(
    prefix="/api/promotions",
    tags=["promotions"],
)


@router.post("/revenue-estimate")
def estimate_revenue(request: RevenueEstimateRequest):
    """Read-only estimate for sales rows; never rewrites sell-out revenue."""
    try:
        return promotion_pricing.estimate_sales_revenue(
            [row.model_dump() for row in request.rows]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except (DefaultCredentialsError, GoogleAPICallError, SQLAlchemyError, OSError) as e:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to reach the pricing database: {type(e).__name__}: {e}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to estimate promotion revenue: {type(e).__name__}: {e}",
        ) from e

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

    except promotion_service.PromotionClashError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Database constraint error: {e.orig}"
            ),
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
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
def list_promotions(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default="", max_length=200),
    sort: str = "period_start",
    direction: str = "desc",
    retailer: list[str] = Query(default=[]),
    store: list[str] = Query(default=[]),
    period: list[str] = Query(default=[]),
    promo_type: list[str] = Query(default=[]),
    mechanic: list[str] = Query(default=[]),
    status: list[str] = Query(default=[]),
):
    """One page of the promotion overview (promotion_service.list_promotion_page)."""
    try:
        return promotion_service.list_promotion_page(
            limit=limit,
            offset=offset,
            search=search,
            sort=sort,
            direction=direction,
            retailer=retailer,
            store=store,
            period=period,
            promo_type=promo_type,
            mechanic=mechanic,
            status=status,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve promotions: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# FILTER OPTIONS
#
# Declared before /{promotion_id}, which would otherwise take
# "filter-options" as an id.
# ============================================================


@router.get("/filter-options")
def get_filter_options():
    try:
        return promotion_service.get_promotion_filter_options()

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to retrieve promotion filter options: "
                f"{type(e).__name__}: {e}"
            ),
        )


# ============================================================
# PROMOTION READ ONE
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

    except promotion_service.PromotionClashError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )

    except IntegrityError as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Database constraint error: {e.orig}"
            ),
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
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
