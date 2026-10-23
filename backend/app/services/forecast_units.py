from datetime import date

from app import config
from app.services import bigquery

# Read-only. One row per customer x SKU x month already, maintained by the
# BigQuery procedure run_monthly_forecast_pipeline
FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW


def get_forecast_units(customer_id: int) -> dict[str, dict[date, float]]:
    """Predicted sell-out units (cartons) for one customer as {sku: {month: units}}."""

    return get_forecast_units_by_customer([customer_id]).get(customer_id, {})


def get_forecast_units_by_customer(
    customer_ids: list[int],
) -> dict[int, dict[str, dict[date, float]]]:
    """
    Predicted sell-out units (cartons) for several customers in one query, as
    {customer_id: {sku: {month: units}}}. One BigQuery job instead of one per
    customer, since each job costs seconds however few rows it returns.

    The customers are picked out here, not in the query: the view is small
    (one row per customer x SKU x forecast month), and a customer filter is
    pushed down into its window functions and made the job measurably slower
    (about 7-10 s with `customer_id = @id`, 13-18 s with `IN UNNEST(@ids)`,
    6-9 s with no filter, measured October 2026).
    Only rows that carry a forecast are read: a missing month is not the same
    as a forecast of zero, so it is simply absent from the result rather than
    filled in.
    """

    if not customer_ids:
        return {}

    query = f"""
        SELECT
          customer_id,
          sku,
          month_year,
          forecast_current

        FROM `{FORECAST_OUTPUT_VIEW}`

        WHERE forecast_current IS NOT NULL
    """
    df = bigquery.get_bigquery_client().query(query).result().to_dataframe()

    wanted = set(customer_ids)
    forecast: dict[int, dict[str, dict[date, float]]] = {}
    for row in df.to_dict(orient="records"):
        customer_id = int(row["customer_id"])
        if customer_id not in wanted:
            continue
        month = row["month_year"]
        month = month.date() if hasattr(month, "date") else month
        by_sku = forecast.setdefault(customer_id, {})
        by_sku.setdefault(row["sku"], {})[month.replace(day=1)] = float(row["forecast_current"])
    return forecast
