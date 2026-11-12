from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from sqlalchemy.exc import SQLAlchemyError

from app.services import bigquery, forecast_refresh_worker, forecast_service

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

_CREDENTIALS_DETAIL = (
    "BigQuery credentials are not configured. Locally, set "
    "GOOGLE_APPLICATION_CREDENTIALS in backend/.env.backend to a service "
    "account key or run `gcloud auth application-default login`; on Cloud "
    "Run, check the service's service account. It needs BigQuery Data "
    "Viewer + Job User access."
)


# The web proxy must not redirect this request to the API host, which cannot
# receive the web host's SSO cookie. Keep the slash route for existing callers.
@router.get("/", include_in_schema=False)
@router.get("")
def get_forecast(
    background_tasks: BackgroundTasks,
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    sku_range: str | None = None,
):
    background_tasks.add_task(forecast_refresh_worker.recover_best_effort)
    try:
        return forecast_service.get_forecast_view(
            product_name=product_name,
            customer_name=customer_name,
            start_date=start_date,
            end_date=end_date,
            sku_range=sku_range,
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


@router.get("/alternatives")
def get_forecast_alternatives(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        return forecast_service.get_forecast_alternatives(
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


@router.get("/options")
def get_forecast_options():
    try:
        return bigquery.get_forecast_options()
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")


# All three below are best effort (the services never raise): they feed small
# notes on the Forecast page and its help panel, so they sit outside GET / and can't slow or
# fail the chart.
@router.get("/initial-status")
def get_initial_status():
    """Per-year Initial Yearly Forecast lock state, for the note under the chart."""
    return forecast_service.get_initial_status()


@router.get("/missing-months")
def get_missing_months():
    """Each customer's months with no sales file, for the help panel (all customers)."""
    return forecast_service.get_missing_months()


@router.get("/refresh-status")
def get_refresh_status():
    """Whether an event forecast refresh is waiting or running ("Forecast updating…")."""
    return forecast_refresh_worker.refresh_status_best_effort()
