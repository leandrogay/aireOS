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


@router.get("/skus")
def get_sku_ranking(
    metric: str = "value",
    order: str = "desc",
    sku: str | None = None,
    mode: str | None = None,
    customer: str = bigquery.DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        ranked = bigquery.get_sku_ranking(
            metric=metric,
            order=order,
            sku=sku,
            mode=mode,
            customer=customer,
            store=store,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {
        "metric": metric,
        "order": order,
        "sku": sku,
        "mode": mode,
        "customer": customer,
        "store": store,
        "start_date": start_date,
        "end_date": end_date,
        "skus": ranked.to_dict(orient="records") if not ranked.empty else [],
    }

@router.get("/sku-options")
def get_sku_options(customer: str = bigquery.DEFAULT_CUSTOMER):
    try:
        options = bigquery.get_sku_options(customer=customer)
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {"options": options}

@router.get("/store-options")
def get_store_options(customer: str = bigquery.DEFAULT_CUSTOMER):
    try:
        options = bigquery.get_store_options(customer=customer)
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {"options": options}

@router.get("/customer-options")
def get_customer_options():
    """Distinct top-level customers (retailer families), for the page-header selector."""
    try:
        options = bigquery.get_customer_options()
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

    return {"options": options}

@router.get("/dashboard-summary")
def get_dashboard_summary(
    granularity: str = "week",
    sku: str | None = None,
    customer: str = bigquery.DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        return bigquery.get_dashboard_summary(
            granularity=granularity,
            sku=sku,
            customer=customer,
            store=store,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")

@router.get("/period-comparison")
def get_period_comparison(
    comparison_type: str | None = None,
    current_start: str | None = None,
    current_end: str | None = None,
    previous_start: str | None = None,
    previous_end: str | None = None,
    mode: str | None = None,
    sku: str | None = None,
    customer: str = bigquery.DEFAULT_CUSTOMER,
    store: str | None = None,
):
    try:
        return bigquery.get_period_comparison(
            comparison_type=comparison_type,
            current_start=current_start,
            current_end=current_end,
            previous_start=previous_start,
            previous_end=previous_end,
            mode=mode,
            sku=sku,
            customer=customer,
            store=store,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")


@router.get("/default-date-range")
def get_default_date_range(
    customer: str = bigquery.DEFAULT_CUSTOMER, mode: str | None = None, period: str = "month"
):
    try:
        return bigquery.get_default_date_range(customer=customer, mode=mode, period=period)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")


@router.get("/last-updated")
def get_last_updated():
    """Latest BigQuery loaded_at per retailer, across every customer."""
    try:
        return {"channels": bigquery.get_data_freshness()}
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail=_CREDENTIALS_DETAIL)
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")
