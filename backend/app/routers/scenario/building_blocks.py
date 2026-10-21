from fastapi import APIRouter, HTTPException
from google.auth.exceptions import GoogleAuthError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import config
from app.schemas.scenario.building_blocks import ScenarioBuildingBlockCreate, ScenarioBuildingBlockUpdate
from app.services.scenario import building_blocks as building_blocks_service


# Scenario builder building blocks are under /api/scenario/building-blocks
# (the /api/scenario prefix comes from __init__.py).
router = APIRouter(
    prefix="/building-blocks",
    tags=["scenario"],
)

_DATABASE_DETAIL = (
    "Unable to reach the scenario database (Cloud SQL). Check the Cloud SQL "
    "connection settings in backend/.env.backend."
)

_NOT_FOUND_DETAIL = "Building block not found"


def _database_error(e: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"{_DATABASE_DETAIL} ({type(e).__name__}: {e})")


# ============================================================
# READ
# ============================================================


@router.get("")
def list_building_blocks():
    try:
        return building_blocks_service.list_building_blocks()

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve building blocks: {type(e).__name__}: {e}",
        )


# ============================================================
# WRITES
# ============================================================


@router.post("", status_code=201)
def create_building_block(block: ScenarioBuildingBlockCreate):
    try:
        return building_blocks_service.create_building_block(block.model_dump())

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # A customer or SKU removed between the lookup and the insert.
    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="The customer or SKU changed while saving. Refresh the page and try again.",
        )

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save the building block: {type(e).__name__}: {e}",
        )


@router.put("/{block_id}")
def update_building_block(block_id: int, block: ScenarioBuildingBlockUpdate):
    try:
        updated = building_blocks_service.update_building_block(block_id, block.model_dump())
        if updated is None:
            raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)
        return updated

    except HTTPException:
        raise

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="The customer or SKU changed while saving. Refresh the page and try again.",
        )

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save the building block: {type(e).__name__}: {e}",
        )


@router.delete("/{block_id}")
def delete_building_block(block_id: int):
    try:
        if not building_blocks_service.delete_building_block(block_id):
            raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)
        return {"deleted": True}

    except HTTPException:
        raise

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete the building block: {type(e).__name__}: {e}",
        )
