import re
from datetime import date, datetime, timezone
from functools import lru_cache
import pandas as pd
from google.cloud import bigquery
from app import config

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Legacy mock table; only forecast_service's out-of-band refresh still writes it.
BQ_FORECAST_TABLE = config.BQ_FORECAST_TABLE
# Final forecast the Forecast page reads (see config.BQ_FORECAST_OUTPUT_VIEW).
BQ_FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW
# Closed monthly sell-out. Forecast actuals and realised prices are read here;
# the output view only carries actuals for months inside its forecast window.
BQ_MONTHLY_SALES_VIEW = config.BQ_MONTHLY_SALES_VIEW

# Named explicitly, never SELECT *, so columns the pipeline adds later (tier
# columns, model tags) can't change the API's shape. All from the view except
# customer_name / product_name, which come from the catalog joins below.
FORECAST_OUTPUT_COLUMNS = [
    "customer_id",
    "customer_name",
    "sku",
    "product_name",
    "month_year",
    "forecast_initial",
    "initial_source_model",
    "initial_generated_at",
    "forecast_previous",
    "previous_source_model",
    "previous_generated_at",
    "forecast_current",
    "current_source_model",
    "current_generated_at",
    "current_low_80",
    "current_high_80",
    "current_backtest_smape",
    "current_confidence_band",
    "promo_mix",
]

# Realised price = revenue / cartons over each SKU's latest N sales months.
# The models forecast cartons only; this prices them the way FairPrice's own
# revenue figures do (catalog skus.price runs 40-65% above it).
REALISED_PRICE_MONTHS = 6

@lru_cache(maxsize=1)
def get_bigquery_client(project="aire-data") -> bigquery.Client:
    # Cached so every filter change reuses one client (and its underlying
    # HTTP session/credentials) instead of paying client-construction cost
    # on every request — same pattern as storage.get_storage_client().
    return bigquery.Client(project=project)


def _validate_date(value: str | None, field_name: str) -> None:
    if value is not None and not DATE_PATTERN.match(value):
        raise ValueError(f"{field_name} must be in YYYY-MM-DD format")


def _iso_date(value) -> str | None:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)[:10]


def _iso_stamp(value) -> str | None:
    """DATE stays YYYY-MM-DD; a DATETIME/TIMESTAMP keeps the clock time."""
    # pd.isna, not just a float check: an all-NULL TIMESTAMP column comes
    # back as NaT, which is a datetime and has no strftime.
    if value is None or pd.isna(value):
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.strftime("%Y-%m-%dT%H:%M:%SZ")
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    ts = pd.to_datetime(value, utc=True)
    if pd.isna(ts):
        return None
    if ts.hour or ts.minute or ts.second or getattr(ts, "nanosecond", 0):
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    return ts.strftime("%Y-%m-%d")


def _json_number(value):
    if value is None or pd.isna(value):
        return None
    return float(value)


def _json_int(value):
    if value is None or pd.isna(value):
        return None
    return int(value)


def _json_str(value):
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _forecast_output_row(record: dict) -> dict:
    # NULL stays None throughout: a blank forecast line (no initial for a
    # SKU or year without a snapshot, no previous after the first run) must
    # not be charted as zero.
    return {
        "customer_id": _json_int(record.get("customer_id")),
        "customer_name": _json_str(record.get("customer_name")),
        "sku": _json_str(record.get("sku")),
        "product_name": _json_str(record.get("product_name")),
        "month_year": _iso_date(record.get("month_year")),
        "forecast_initial": _json_number(record.get("forecast_initial")),
        "initial_source_model": _json_str(record.get("initial_source_model")),
        "initial_generated_at": _iso_stamp(record.get("initial_generated_at")),
        "forecast_previous": _json_number(record.get("forecast_previous")),
        "previous_source_model": _json_str(record.get("previous_source_model")),
        "previous_generated_at": _iso_stamp(record.get("previous_generated_at")),
        "forecast_current": _json_number(record.get("forecast_current")),
        "current_source_model": _json_str(record.get("current_source_model")),
        "current_generated_at": _iso_stamp(record.get("current_generated_at")),
        "current_low_80": _json_number(record.get("current_low_80")),
        "current_high_80": _json_number(record.get("current_high_80")),
        "current_backtest_smape": _json_number(record.get("current_backtest_smape")),
        "current_confidence_band": _json_str(record.get("current_confidence_band")),
        "promo_mix": _json_str(record.get("promo_mix")),
    }


def _actual_row(record: dict) -> dict:
    return {
        "month_year": _iso_date(record.get("month_year")),
        "customer_id": _json_int(record.get("customer_id")),
        "customer_name": record.get("customer_name"),
        "product_name": record.get("product_name"),
        "quantity_cartons": _json_number(record.get("quantity_cartons")),
        "revenue": _json_number(record.get("revenue")),
    }


def _name_and_date_filters(
    product_name: str | None,
    customer_name: str | None,
    start_date: str | None,
    end_date: str | None,
    date_column: str,
) -> tuple[list[str], list]:
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")

    where_clauses = ["1 = 1"]
    query_parameters = []
    if product_name:
        where_clauses.append("product_name = @product_name")
        query_parameters.append(
            bigquery.ScalarQueryParameter("product_name", "STRING", product_name)
        )
    if customer_name:
        where_clauses.append("customer_name = @customer_name")
        query_parameters.append(
            bigquery.ScalarQueryParameter("customer_name", "STRING", customer_name)
        )
    if start_date:
        where_clauses.append(f"{date_column} >= @start_date")
        query_parameters.append(
            bigquery.ScalarQueryParameter("start_date", "DATE", start_date)
        )
    if end_date:
        where_clauses.append(f"{date_column} <= @end_date")
        query_parameters.append(
            bigquery.ScalarQueryParameter("end_date", "DATE", end_date)
        )
    return where_clauses, query_parameters


def _catalog_dataset() -> str:
    # public_customers / public_skus are replicated into the same dataset as
    # the output view.
    return BQ_FORECAST_OUTPUT_VIEW.rsplit(".", 1)[0]


# The view is keyed by customer_id + sku; the page filters by name, so names
# are joined on from the catalog here and the filters apply to the result.
_FORECAST_OUTPUT_WITH_NAMES = """
    SELECT
      output.*,
      customer.customer_name,
      product.product_name
    FROM `{view}` AS output
    JOIN `{dataset}.public_customers` AS customer
      ON customer.customer_id = output.customer_id
    JOIN `{dataset}.public_skus` AS product
      ON product.sku = output.sku
"""


def get_forecast_output_rows(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """Forecast rows from aire_forecasting_output, one per customer x SKU x month.

    Cartons only; forecast_service prices them. The initial / previous /
    current lines and the model behind each month are already chosen by
    the BigQuery pipeline, so nothing here re-derives them.
    """
    where_clauses, query_parameters = _name_and_date_filters(
        product_name, customer_name, start_date, end_date, "month_year"
    )
    source = _FORECAST_OUTPUT_WITH_NAMES.format(
        view=BQ_FORECAST_OUTPUT_VIEW, dataset=_catalog_dataset()
    )
    query = f"""
        WITH output_with_names AS ({source})
        SELECT
          {", ".join(FORECAST_OUTPUT_COLUMNS)}
        FROM output_with_names
        WHERE {" AND ".join(where_clauses)}
        ORDER BY customer_name, product_name, month_year
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    if df.empty:
        return []
    return [_forecast_output_row(record) for record in df.to_dict(orient="records")]


def get_realised_prices(
    product_name: str | None = None,
    customer_name: str | None = None,
) -> dict[tuple[int, str], float]:
    """Realised price per carton for each customer x SKU, keyed (customer_id, sku).

    Revenue / cartons over the SKU's latest REALISED_PRICE_MONTHS complete
    sales months, so it moves with FairPrice's actual pricing and promos.
    A SKU with no sales has no entry, and its forecast revenue stays blank.
    """
    where_clauses, query_parameters = _name_and_date_filters(
        product_name, customer_name, None, None, "period_start"
    )
    query_parameters.append(
        bigquery.ScalarQueryParameter("price_months", "INT64", REALISED_PRICE_MONTHS)
    )
    query = f"""
        SELECT
          customer_id,
          sku,
          SAFE_DIVIDE(SUM(revenue), SUM(quantity_cartons)) AS realised_price
        FROM (
          SELECT customer_id, sku, revenue, quantity_cartons
          FROM `{BQ_MONTHLY_SALES_VIEW}`
          WHERE {" AND ".join(where_clauses)}
            AND quantity_cartons > 0
            AND revenue IS NOT NULL
            -- The current month is still filling up.
            AND period_start < DATE_TRUNC(CURRENT_DATE(), MONTH)
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY customer_id, sku ORDER BY period_start DESC
          ) <= @price_months
        )
        GROUP BY customer_id, sku
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()

    prices = {}
    for record in df.to_dict(orient="records"):
        price = _json_number(record.get("realised_price"))
        if price is not None:
            prices[(_json_int(record.get("customer_id")), str(record.get("sku")))] = price
    return prices


def get_forecast_actuals(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    # period_start is the first of the month in v_customer_monthly_sales,
    # so it lines up with forecast month_year after we alias it.
    where_clauses, query_parameters = _name_and_date_filters(
        product_name, customer_name, start_date, end_date, "period_start"
    )

    query = f"""
        SELECT
          customer_id,
          customer_name,
          product_name,
          period_start AS month_year,
          quantity_cartons,
          revenue
        FROM `{BQ_MONTHLY_SALES_VIEW}`
        WHERE {" AND ".join(where_clauses)}
        ORDER BY customer_name, product_name, period_start
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    if df.empty:
        return []
    return [_actual_row(record) for record in df.to_dict(orient="records")]


def get_forecast_options() -> dict:
    # Product/customer lists and the picker bounds come from both the
    # forecast output and actuals, so a year that only exists on one side is
    # still selectable (e.g. 2024 actuals before the first forecast month).
    source = _FORECAST_OUTPUT_WITH_NAMES.format(
        view=BQ_FORECAST_OUTPUT_VIEW, dataset=_catalog_dataset()
    )
    query = f"""
        SELECT
          product_name,
          customer_name,
          month_year
        FROM ({source})
        UNION ALL
        SELECT
          product_name,
          customer_name,
          period_start AS month_year
        FROM `{BQ_MONTHLY_SALES_VIEW}`
    """
    client = get_bigquery_client()
    df = client.query(query).result().to_dataframe()
    if df.empty:
        return {
            "products": [],
            "customers": [],
            "start_date": None,
            "end_date": None,
        }

    months = df["month_year"].dropna()
    return {
        "products": sorted(
            {name for name in df["product_name"].dropna().tolist() if name}
        ),
        "customers": sorted(
            {name for name in df["customer_name"].dropna().tolist() if name}
        ),
        "start_date": _iso_date(months.min()) if not months.empty else None,
        "end_date": _iso_date(months.max()) if not months.empty else None,
    }


def get_sales_loaded_at(customer_name: str | None = None) -> str | None:
    """When the customer's sales last loaded into v_customer_monthly_sales.

    The forecast-line stamps (current / previous / initial generated_at)
    are not queried here: forecast_service takes them from the forecast
    rows it already fetched, so the slow output view is read once per page
    load. An empty customer_name means every customer (the Forecast
    "All customers" filter).
    """
    customer_name = customer_name or None
    where_clauses = ["1 = 1"]
    query_parameters = []
    if customer_name:
        where_clauses.append("customer_name = @customer_name")
        query_parameters.append(
            bigquery.ScalarQueryParameter("customer_name", "STRING", customer_name)
        )
    query = f"""
        SELECT MAX(latest_sales_loaded_at) AS latest_sales_loaded_at
        FROM `{BQ_MONTHLY_SALES_VIEW}`
        WHERE {" AND ".join(where_clauses)}
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    if df.empty:
        return None
    return _iso_stamp(df.iloc[0]["latest_sales_loaded_at"])
