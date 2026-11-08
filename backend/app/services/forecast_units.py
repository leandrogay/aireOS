from datetime import date

from app import config
from app.services import bigquery

# Read-only. One row per customer x SKU x month x tier, maintained by the
# BigQuery procedure run_monthly_forecast_pipeline. Inventory plans on one
# model, Tier 0 (available for every SKU); the other tiers' rows are dropped.
FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW
FORECAST_TIER = bigquery.DEFAULT_FORECAST_TIER


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
    6-9 s with no filter, measured October 2026). The tier is picked out
    here too, for the same reason: without it each month would come back
    three times, once per model.
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
          tier,
          forecast_current

        FROM `{FORECAST_OUTPUT_VIEW}`

        WHERE forecast_current IS NOT NULL
    """
    df = bigquery.get_bigquery_client().query(query).result().to_dataframe()

    wanted = set(customer_ids)
    forecast: dict[int, dict[str, dict[date, float]]] = {}
    for row in df.to_dict(orient="records"):
        customer_id = int(row["customer_id"])
        if customer_id not in wanted or row.get("tier") != FORECAST_TIER:
            continue
        month = row["month_year"]
        month = month.date() if hasattr(month, "date") else month
        by_sku = forecast.setdefault(customer_id, {})
        by_sku.setdefault(row["sku"], {})[month.replace(day=1)] = float(row["forecast_current"])
    return forecast


def _first_of_month(value) -> date:
    value = value.date() if hasattr(value, "date") else value
    return value.replace(day=1)


def get_forecast_lines(customer_id: int) -> dict[str, dict[str, dict[date, float]]]:
    """
    One customer's current, previous and Initial Yearly forecasts in one query,
    as {"current" | "previous" | "initial": {sku: {month: units}}}. The sell-in
    plan uses the initial for months the current run does not reach (the
    current starts after the newest sales month, which can be ahead of the last
    month with sell-in actuals); the previous (last month's run) is only drawn,
    so last month's sales can be read against what was forecast a month ahead.
    The customer is picked out in Python for the same reason as
    get_forecast_units_by_customer; a NULL is left out.
    """

    query = f"""
        SELECT
          customer_id,
          sku,
          month_year,
          forecast_current,
          forecast_previous,
          forecast_initial

        FROM `{FORECAST_OUTPUT_VIEW}`

        WHERE forecast_current IS NOT NULL
           OR forecast_previous IS NOT NULL
           OR forecast_initial IS NOT NULL
    """
    df = bigquery.get_bigquery_client().query(query).result().to_dataframe()

    lines: dict[str, dict[str, dict[date, float]]] = {"current": {}, "previous": {}, "initial": {}}
    for row in df.to_dict(orient="records"):
        if int(row["customer_id"]) != customer_id:
            continue
        month = _first_of_month(row["month_year"])
        for line in lines:
            value = row.get(f"forecast_{line}")
            if value is None or value != value:  # NULL comes back as None or NaN
                continue
            lines[line].setdefault(row["sku"], {})[month] = float(value)
    return lines
