from fastapi import APIRouter, HTTPException
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from sqlalchemy.exc import SQLAlchemyError

from app.services import bigquery, forecast_service

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

_CREDENTIALS_DETAIL = (
    "BigQuery credentials are not configured. Set "
    "GOOGLE_APPLICATION_CREDENTIALS in backend/.env.backend to a service "
    "account key with BigQuery Data Viewer + Job User access."
)


@router.get("/")
def get_forecast(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        return forecast_service.get_forecast_view(
            product_name=product_name,
            customer_name=customer_name,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")
    except SQLAlchemyError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to reach the promotions database: {type(e).__name__}: {e}",
        )


@router.get("/options")
def get_forecast_options():
    try:
        return bigquery.get_forecast_options()
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")
