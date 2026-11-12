from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from google.auth.exceptions import GoogleAuthError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import config
from app.schemas.scenario.promotions import ScenarioPromotionCreate, ScenarioPromotionUpdate
from app.services.scenario import common
from app.services.scenario import promotions as promotions_service


# Scenario builder promotions are under /api/scenario/promotions (the
# /api/scenario prefix comes from __init__.py). Same status codes as
# building_blocks.py.
router = APIRouter(
    prefix="/promotions",
    tags=["scenario"],
)

_DATABASE_DETAIL = (
    "Unable to reach the scenario database (Cloud SQL). Check the Cloud SQL "
    "connection settings in backend/.env.backend."
)

_NOT_FOUND_DETAIL = "Scenario promotion not found"

_CONFLICT_DETAIL = "The customer or SKU changed while saving. Refresh the page and try again."


def _database_error(e: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"{_DATABASE_DETAIL} ({type(e).__name__}: {e})")


# ============================================================
# READ
# ============================================================


@router.get("")
def list_scenario_promotions(plan: Literal["scenario", "budget"] = "scenario", year: int | None = Query(None, ge=2000, le=2100)):
    try:
        # Budget planning lists one year's entries (year); Current forecast has no years.
        return promotions_service.list_scenario_promotions() if plan == "scenario" else promotions_service.list_scenario_promotions(plan, year)

    except common.BudgetSetupRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e))

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve scenario promotions: {type(e).__name__}: {e}",
        )


# ============================================================
# WRITES
# ============================================================


@router.post("", status_code=201)
def create_scenario_promotion(promotion: ScenarioPromotionCreate):
    try:
        return promotions_service.create_scenario_promotion(promotion.model_dump())

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except IntegrityError:
        raise HTTPException(status_code=409, detail=_CONFLICT_DETAIL)

    except common.BudgetSetupRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e))

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save the scenario promotion: {type(e).__name__}: {e}",
        )


@router.put("/{promotion_id}")
def update_scenario_promotion(promotion_id: int, promotion: ScenarioPromotionUpdate):
    try:
        updated = promotions_service.update_scenario_promotion(promotion_id, promotion.model_dump())
        if updated is None:
            raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)
        return updated

    except HTTPException:
        raise

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except IntegrityError:
        raise HTTPException(status_code=409, detail=_CONFLICT_DETAIL)

    except common.BudgetSetupRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e))

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save the scenario promotion: {type(e).__name__}: {e}",
        )


@router.delete("/{promotion_id}")
def delete_scenario_promotion(promotion_id: int, plan: Literal["scenario", "budget"] = "scenario"):
    try:
        if not (promotions_service.delete_scenario_promotion(promotion_id) if plan == "scenario" else promotions_service.delete_scenario_promotion(promotion_id, plan)):
            raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)
        return {"deleted": True}

    except HTTPException:
        raise

    except common.BudgetSetupRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e))

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete the scenario promotion: {type(e).__name__}: {e}",
        )
