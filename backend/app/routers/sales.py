from fastapi import APIRouter, HTTPException
from google.auth.exceptions import GoogleAuthError
from sqlalchemy.exc import SQLAlchemyError

from app import config
from app.services import sellout_service

router = APIRouter(prefix="/api/sales", tags=["sales"])

_DATABASE_DETAIL = (
    "Unable to reach the sales database (Cloud SQL). Check the Cloud SQL "
    "connection settings in backend/.env.backend."
)


def _database_error(e: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"{_DATABASE_DETAIL} ({type(e).__name__}: {e})")


@router.get("/skus")
def get_sku_ranking(
    metric: str = "value",
    order: str = "desc",
    sku: str | None = None,
    mode: str | None = None,
    customer: str = sellout_service.DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        ranked = sellout_service.get_sku_ranking(
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
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

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
def get_sku_options(customer: str = sellout_service.DEFAULT_CUSTOMER):
    try:
        options = sellout_service.get_sku_options(customer=customer)
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    return {"options": options}

@router.get("/store-options")
def get_store_options(customer: str = sellout_service.DEFAULT_CUSTOMER):
    try:
        options = sellout_service.get_store_options(customer=customer)
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    return {"options": options}

@router.get("/customer-options")
def get_customer_options():
    """Distinct top-level customers (retailer families), for the page-header selector."""
    try:
        options = sellout_service.get_customer_options()
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

    return {"options": options}

@router.get("/dashboard-summary")
def get_dashboard_summary(
    granularity: str = "week",
    sku: str | None = None,
    customer: str = sellout_service.DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    try:
        return sellout_service.get_dashboard_summary(
            granularity=granularity,
            sku=sku,
            customer=customer,
            store=store,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)

@router.get("/period-comparison")
def get_period_comparison(
    comparison_type: str | None = None,
    current_start: str | None = None,
    current_end: str | None = None,
    previous_start: str | None = None,
    previous_end: str | None = None,
    mode: str | None = None,
    sku: str | None = None,
    customer: str = sellout_service.DEFAULT_CUSTOMER,
    store: str | None = None,
):
    try:
        return sellout_service.get_period_comparison(
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
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)


@router.get("/default-date-range")
def get_default_date_range(
    customer: str = sellout_service.DEFAULT_CUSTOMER, mode: str | None = None, period: str = "month"
):
    try:
        return sellout_service.get_default_date_range(customer=customer, mode=mode, period=period)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)


@router.get("/last-updated")
def get_last_updated():
    """Latest Cloud SQL loaded_at per retailer, across every customer."""
    try:
        return {"channels": sellout_service.get_data_freshness()}
    except (SQLAlchemyError, config.ConfigError, GoogleAuthError) as e:
        raise _database_error(e)
