from datetime import date

from google.api_core.exceptions import DeadlineExceeded

from app import config
from app.services import bigquery

# Read-only. One row per customer x SKU x month x tier, maintained by the
# BigQuery procedure run_monthly_forecast_pipeline. Inventory plans on one
# model, Tier 0 (available for every SKU); the other tiers' rows are dropped.
FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW
FORECAST_TIER = bigquery.DEFAULT_FORECAST_TIER

# How long a forecast read may take before it is stopped. Normally well under
# this (about a minute at worst in November 2026); a read that hangs on a slow view would otherwise hold a server
# thread (and the browser's connection) for as long as the view takes, until
# nothing else on the page can load. Stopped, it is a GoogleAPICallError, so
# every route already answers it with a 503 the page can show.
FORECAST_QUERY_TIMEOUT_SECONDS = 120


def _read_forecast(query: str):
    """Run a forecast read, or stop it and raise DeadlineExceeded after the time limit."""

    job = bigquery.get_bigquery_client().query(query)
    try:
        # The REST download, said outright: the BigQuery Storage client isn't
        # installed, and asking for it by default logs a warning on every read.
        return job.result(timeout=FORECAST_QUERY_TIMEOUT_SECONDS).to_dataframe(create_bqstorage_client=False)
    except TimeoutError as exc:
        try:
            job.cancel()
        except Exception:
            pass  # Best effort: the job stops on its own once it finishes.
        raise DeadlineExceeded(
            f"The forecast took longer than {FORECAST_QUERY_TIMEOUT_SECONDS} seconds to load from BigQuery, "
            "so it was stopped. Try again in a few minutes."
        ) from exc


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
    df = _read_forecast(query)

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
    The customer and the tier (Tier 0, as get_forecast_units_by_customer) are
    picked out in Python for the same reason as there; a NULL is left out.
    """

    query = f"""
        SELECT
          customer_id,
          sku,
          month_year,
          tier,
          forecast_current,
          forecast_previous,
          forecast_initial

        FROM `{FORECAST_OUTPUT_VIEW}`

        WHERE forecast_current IS NOT NULL
           OR forecast_previous IS NOT NULL
           OR forecast_initial IS NOT NULL
    """
    df = _read_forecast(query)

    lines: dict[str, dict[str, dict[date, float]]] = {"current": {}, "previous": {}, "initial": {}}
    for row in df.to_dict(orient="records"):
        if int(row["customer_id"]) != customer_id or row.get("tier") != FORECAST_TIER:
            continue
        month = _first_of_month(row["month_year"])
        for line in lines:
            value = row.get(f"forecast_{line}")
            if value is None or value != value:  # NULL comes back as None or NaN
                continue
            lines[line].setdefault(row["sku"], {})[month] = float(value)
    return lines
