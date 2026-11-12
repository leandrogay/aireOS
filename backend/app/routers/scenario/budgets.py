from fastapi import APIRouter, Depends, HTTPException, Query
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import GoogleAuthError
from sqlalchemy.exc import SQLAlchemyError

from app import config
from app.auth import current_user_email
from app.schemas.scenario.budgets import BudgetLock, BudgetOfficial, BudgetStart
from app.services.scenario import budgets, common

router = APIRouter(prefix="/budgets", tags=["scenario"])


@router.get("")
def read_budgets(year: int | None = Query(None, ge=2000, le=2100), version: int | None = Query(None, ge=1)):
    try:
        return budgets.read_budgets(year, version)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to read budgets: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to read budgets: {type(exc).__name__}: {exc}")


@router.post("/lock", status_code=201)
def lock_budget(body: BudgetLock, locked_by: str = Depends(current_user_email)):
    try:
        return budgets.lock_budget(body.year, locked_by, body.name, body.make_official)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, GoogleAPICallError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to lock budget: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to lock budget: {type(exc).__name__}: {exc}")


@router.post("/official")
def set_official_budget(body: BudgetOfficial):
    try:
        official = budgets.set_official(body.year, body.version)
        if official is None:
            raise HTTPException(404, detail="Budget version not found")
        return official
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to change the official budget: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to change the official budget: {type(exc).__name__}: {exc}")


@router.post("/start")
def start_budget(body: BudgetStart):
    try:
        started = budgets.start_budget(body.year, body.version)
        if started is None:
            raise HTTPException(404, detail="Budget version not found")
        return started
    except HTTPException:
        raise
    # A customer, SKU or range in the copied version that no longer exists.
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to start the budget: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to start the budget: {type(exc).__name__}: {exc}")


@router.delete("/{year}/versions/{version}")
def delete_budget_version(year: int, version: int, deleted_by: str = Depends(current_user_email)):
    # Hidden from the app, kept in the database (budgets.delete_version).
    try:
        if not budgets.delete_version(year, version, deleted_by):
            raise HTTPException(404, detail="Budget version not found")
        return {"deleted": True}
    except HTTPException:
        raise
    except budgets.OfficialBudgetDeleteError as exc:
        raise HTTPException(409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to delete the budget version: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to delete the budget version: {type(exc).__name__}: {exc}")
