import os
from datetime import date

from google.cloud import bigquery as bq

from app.services import bigquery


# Read-only. The same weekly retailer sell-out the sales dashboard reads
# (BQ_SELLOUT_TABLE is the setting the dashboard uses on the branches that
# have moved to public_sellout), so inventory and dashboard sell-out agree.
SELLOUT_UNITS_TABLE = os.environ.get("BQ_SELLOUT_TABLE", "aire-data.Aire_Data.public_sellout")


def get_monthly_sellout(
    retailer_ids: list[int],
) -> tuple[dict[str, dict[date, float]], date | None]:
    """
    Actual sell-out units per SKU and month for the given retailers, plus the
    last day the data covers.

    Weekly rows (Thursday to Wednesday) are counted in the month they start in,
    the same rule as the dashboard's monthly view, so a week that spans two
    months is not split. Returns ({sku: {first_of_month: units}}, data_through);
    data_through is None when there is no data. A month is only complete once
    data_through reaches its last day.
    """

    if not retailer_ids:
        return {}, None

    query = f"""
        SELECT
          sku,
          DATE_TRUNC(period_start, MONTH) AS month,
          SUM(quantity_units) AS units,
          MAX(period_end) AS data_through

        FROM `{SELLOUT_UNITS_TABLE}`

        WHERE period_type = 'week'
          AND retailer_id IN UNNEST(@retailer_ids)

        GROUP BY sku, month
    """
    job_config = bq.QueryJobConfig(
        query_parameters=[bq.ArrayQueryParameter("retailer_ids", "INT64", retailer_ids)]
    )
    df = bigquery.get_bigquery_client().query(query, job_config=job_config).result().to_dataframe()

    units: dict[str, dict[date, float]] = {}
    data_through = None
    for row in df.to_dict(orient="records"):
        month = row["month"]
        month = month.date() if hasattr(month, "date") else month
        units.setdefault(row["sku"], {})[month] = float(row["units"])

        through = row["data_through"]
        through = through.date() if hasattr(through, "date") else through
        if data_through is None or through > data_through:
            data_through = through

    return units, data_through
