from datetime import datetime
from fastapi import APIRouter, HTTPException
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from app.services import bigquery

router = APIRouter(prefix="/api/sales", tags=["sales"])

_CREDENTIALS_DETAIL = (
    "BigQuery credentials are not configured. Set "
    "GOOGLE_APPLICATION_CREDENTIALS in backend/.env to a service "
    "account key with BigQuery Data Viewer + Job User access."
)

@router.get("/months")
def get_ranking_months():
    try:
        months = bigquery.get_available_ranking_months()
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {
        "months": [
            {"value": m, "label": datetime.strptime(m, "%Y-%m").strftime("%B %Y")}
            for m in months
        ]
    }

@router.get("/weeks")
def get_ranking_weeks(month: str | None = None):
    try:
        weeks = bigquery.get_available_ranking_weeks(month=month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {"weeks": weeks}


@router.get("/skus")
def get_sku_ranking(
    metric: str = "value", order: str = "desc", month: str | None = None, week: str | None = None
):
    try:
        ranked = bigquery.get_sku_ranking(metric=metric, order=order, month=month, week=week)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {
        "metric": metric,
        "order": order,
        "month": month,
        "week": week,
        "skus": ranked.to_dict(orient="records") if not ranked.empty else [],
    }


@router.get("/dashboard-summary")
def get_dashboard_summary(granularity: str = "week"):
    try:
        return bigquery.get_dashboard_summary(granularity=granularity)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")


@router.get("/last-updated")
def get_last_updated():
    """Latest BigQuery loaded_at per offline/online Fairprice channel."""
    try:
        return {"channels": bigquery.get_data_freshness()}
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")