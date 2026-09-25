import os
from datetime import date

from google.cloud import bigquery as bq

from app.services import bigquery


# Read-only. Predicted sell-out units per customer, product and month. The
# table keeps every forecast run (forecast_generated_at) and consecutive runs
# overlap, so a month is forecast once per run that covers it. Only the newest
# run's value for each product-month is read; adding the runs together would
# count the same month two or three times.
FORECAST_UNITS_TABLE = os.environ.get(
    "BQ_FORECAST_UNITS_TABLE", "aire-data.Aire_Data.forecasting_output_xianhui_mock"
)


def get_forecast_units(customer_id: int) -> dict[str, dict[date, float]]:
    """
    Predicted units for one customer as {product_name: {month: units}}, taken
    from the most recent forecast run that covers each month. Only rows that
    carry a prediction are read: the actuals in the same table are already in
    the inventory data. The caller maps product names to SKUs through the
    catalog.
    """

    query = f"""
        SELECT
          product_name,
          month_year,
          predicted_units

        FROM (
          SELECT
            product_name,
            month_year,
            forecast_generated_at,
            SUM(predicted_quantity_units) AS predicted_units

          FROM `{FORECAST_UNITS_TABLE}`

          WHERE customer_id = @customer_id
            AND predicted_quantity_units IS NOT NULL

          GROUP BY product_name, month_year, forecast_generated_at
        )

        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY product_name, month_year
          ORDER BY forecast_generated_at DESC
        ) = 1
    """
    job_config = bq.QueryJobConfig(
        query_parameters=[bq.ScalarQueryParameter("customer_id", "INT64", customer_id)]
    )
    df = bigquery.get_bigquery_client().query(query, job_config=job_config).result().to_dataframe()

    forecast: dict[str, dict[date, float]] = {}
    for row in df.to_dict(orient="records"):
        month = row["month_year"]
        month = month.date() if hasattr(month, "date") else month
        forecast.setdefault(row["product_name"], {})[month.replace(day=1)] = float(
            row["predicted_units"]
        )
    return forecast
