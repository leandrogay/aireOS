from fastapi import APIRouter, HTTPException
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError, GoogleAuthError
from sqlalchemy.exc import SQLAlchemyError

from app import config
from app.services.scenario import tier0_breakdown as breakdown_service


# Tier 0 split into its baseline and the promotions it carries, for the
# Scenario builder (/api/scenario/tier0-breakdown; the /api/scenario prefix
# comes from __init__.py). Read-only.
router = APIRouter(
    prefix="/tier0-breakdown",
    tags=["scenario"],
)

_CREDENTIALS_DETAIL = (
    "BigQuery credentials are not configured. Locally, set "
    "GOOGLE_APPLICATION_CREDENTIALS in backend/.env.backend or run "
    "`gcloud auth application-default login`; on Cloud Run, check the "
    "service's service account."
)

_DATABASE_DETAIL = (
    "Unable to reach the promotions database (Cloud SQL). Check the Cloud SQL "
    "connection settings in backend/.env.backend."
)


@router.get("")
def get_tier0_breakdown(
    customer_name: str | None = None, sku_range: str | None = None,
    basis: str = "current", year: int | None = None,
):
    try:
        return breakdown_service.get_tier0_breakdown(customer_name=customer_name, sku_range=sku_range, basis=basis, year=year)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)

    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise HTTPException(status_code=503, detail=f"{_DATABASE_DETAIL} ({type(e).__name__}: {e})")

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve the Tier 0 breakdown: {type(e).__name__}: {e}",
        )
