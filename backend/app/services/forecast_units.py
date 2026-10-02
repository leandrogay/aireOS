from datetime import date

from google.cloud import bigquery as bq

from app import config
from app.services import bigquery

# Read-only. One row per customer x SKU x month already, maintained by the
# BigQuery procedure run_monthly_forecast_pipeline
FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW


def get_forecast_units(customer_id: int) -> dict[str, dict[date, float]]:
    """
    Predicted sell-out units (cartons) for one customer as {sku: {month: units}}.
    Only rows that carry a forecast are read: a missing month is not the same
    as a forecast of zero, so it is simply absent from the result rather than
    filled in.
    """

    query = f"""
        SELECT
          sku,
          month_year,
          forecast_current

        FROM `{FORECAST_OUTPUT_VIEW}`

        WHERE customer_id = @customer_id
          AND forecast_current IS NOT NULL

        ORDER BY sku, month_year
    """
    job_config = bq.QueryJobConfig(
        query_parameters=[bq.ScalarQueryParameter("customer_id", "INT64", customer_id)]
    )
    df = bigquery.get_bigquery_client().query(query, job_config=job_config).result().to_dataframe()

    forecast: dict[str, dict[date, float]] = {}
    for row in df.to_dict(orient="records"):
        month = row["month_year"]
        month = month.date() if hasattr(month, "date") else month
        forecast.setdefault(row["sku"], {})[month.replace(day=1)] = float(row["forecast_current"])
    return forecast
