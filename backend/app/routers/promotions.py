from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import promotion_service
from app.schemas.promotions import (
    PromotionCreate,
    PromotionUpdate,
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
