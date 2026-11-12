from fastapi import APIRouter, Depends, HTTPException, Query
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import GoogleAuthError
from sqlalchemy.exc import SQLAlchemyError

from app import config
from app.auth import current_user_email
from app.schemas.scenario.budgets import BudgetLock
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
        return budgets.lock_budget(body.year, locked_by)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except common.BudgetSetupRequiredError as exc:
        raise HTTPException(503, detail=str(exc))
    except (SQLAlchemyError, GoogleAuthError, GoogleAPICallError, config.ConfigError) as exc:
        raise HTTPException(503, detail=f"Unable to lock budget: {exc}")
    except Exception as exc:
        raise HTTPException(500, detail=f"Failed to lock budget: {type(exc).__name__}: {exc}")
