"""
BigQuery reads/writes for the forecast, and the legacy refresh entrypoint.

The Forecast page reads forecast rows from aire_forecasting_output (written
by the BigQuery pipeline), monthly actuals and realised prices from
v_customer_monthly_sales, and overlapping promos from Postgres.

The WRITES and REFRESH sections are the legacy P&L path, kept until the
old mock table is retired. It writes BQ_FORECAST_TABLE, whose rows carry the run
date and a run_type of 'rolling' or 'yearly' -- see pl_forecast.py's
FORECAST RUNS section for what those mean. It also:

  1. rebuilds the actual rows from weekly sell-out in v_sales_enriched
     (SALES_ENRICHED_VIEW, read-only) -- complete months only,
  2. adds the next 12-month rolling run once a newer complete month exists,
  3. adds the next calendar year's frozen yearly baseline once its prior
     December is a complete actual month,
  4. fills predicted_quantity_units / predicted_revenue with pl_forecast,
     for rolling and yearly runs separately so neither can bleed into
     the other's computation.

Writes touch only BQ_FORECAST_TABLE, never the sell-out table, and only run
when write=True. They are meant to be triggered out of band
(scripts/refresh_forecast.py), not from a request path.
"""

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
from google.cloud import bigquery

from app.services import catalog_service, pl_forecast, promotion_service
from app.services import bigquery as bigquery_service
from app import config
from app.services.bigquery import get_bigquery_client

logger = logging.getLogger("uvicorn.error")

FORECAST_TABLE = bigquery_service.BQ_FORECAST_TABLE
SALES_ENRICHED_VIEW = config.BQ_SALES_ENRICHED_VIEW


# ============================================================
# READS
# ============================================================

# Weekly sell-out per customer x SKU, online + offline summed. The view sits
# on the Datastream replica of Cloud SQL sellout, which is already unique on
# (retailer_id, store_code, sku, period_start, period_type) -- so, unlike the
# legacy aireOS_fairprice table, nothing needs de-duplicating here. Customers
# are resolved through the same bridge v_customer_monthly_sales uses, so the
# model's history and the page's Actual line agree on customer names.
_SELLOUT_WEEKS_QUERY = """
    SELECT
      sales.period_start,
      customer.customer_name,
      sales.product_name,
      SUM(sales.quantity_units) AS quantity_units,
      ROUND(SUM(sales.revenue), 2) AS revenue
    FROM `{sales_view}` AS sales
    JOIN `{dataset}.public_customer_retailers` AS bridge
      ON bridge.retailer_id = sales.retailer_id
    JOIN `{dataset}.public_customers` AS customer
      ON customer.customer_id = bridge.customer_id
    WHERE sales.period_type = 'week'
      AND sales.product_name IS NOT NULL
      AND customer.customer_name IN UNNEST(@customers)
    GROUP BY sales.period_start, customer.customer_name, sales.product_name
"""


def get_forecast_table_rows() -> pd.DataFrame:
    client = get_bigquery_client()
    return client.query(f"SELECT * FROM `{FORECAST_TABLE}`").result().to_dataframe()


def get_sellout_weeks(customers: list[str]) -> pd.DataFrame:
    """Weekly sell-out for the given customers (online + offline summed)."""
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("customers", "STRING", customers)]
    )
    client = get_bigquery_client()
    # The bridge tables live in the same dataset as the view.
    dataset = SALES_ENRICHED_VIEW.rsplit(".", 1)[0]
    query = _SELLOUT_WEEKS_QUERY.format(sales_view=SALES_ENRICHED_VIEW, dataset=dataset)
    return client.query(query, job_config=job_config).result().to_dataframe()


# Carton columns on an output row -> the revenue column each one prices into.
_REVENUE_COLUMNS = {
    "forecast_initial": "forecast_initial_revenue",
    "forecast_previous": "forecast_previous_revenue",
    "forecast_current": "forecast_current_revenue",
    "current_low_80": "current_low_80_revenue",
    "current_high_80": "current_high_80_revenue",
}


def add_forecast_revenue(rows: list[dict], prices: dict[tuple[int, str], float]) -> list[dict]:
    """Price each row's cartons at its own customer x SKU realised price.

    For the assistant's forecast summary (forecast_summary); the Forecast
    page is volume only and its GET /api/forecast rows are never priced.
    Done per row, before SKUs are summed, so "All SKUs" revenue weights
    every SKU by its own price. A missing price or a blank carton value
    leaves the revenue blank (None), never 0.
    """
    priced = []
    for row in rows:
        price = prices.get((row.get("customer_id"), row.get("sku")))
        revenue = {}
        for cartons_key, revenue_key in _REVENUE_COLUMNS.items():
            cartons = row.get(cartons_key)
            revenue[revenue_key] = (
                round(cartons * price, 2) if cartons is not None and price is not None else None
            )
        priced.append({**row, "realised_price": price, **revenue})
    return priced


def current_horizon_totals(series: list[dict]) -> dict:
    """{tier: {units, series}} for the "Next 12 months" total: every
    customer x SKU's whole Current line (bigquery.get_current_horizon),
    whatever the date filter shows. Cartons only, like the rest of the page.
    """
    totals = {}
    for entry in series:
        tier = totals.setdefault(entry["tier"], {"units": 0.0, "series": 0})
        tier["units"] += entry.get("cartons") or 0.0
        tier["series"] += 1
    return totals


# Stamp column on an output row per forecast line. Not previous_generated_at:
# the rebuilt Previous is stored at the Current run's time minus one second,
# so it says nothing about when Previous was made and is never shown
# (previous_data_month says what Previous was made with).
_GENERATED_AT_COLUMNS = ("current_generated_at", "initial_generated_at")


def _latest_stamps(rows: list[dict]) -> dict:
    stamps = {}
    for column in _GENERATED_AT_COLUMNS:
        values = [row[column] for row in rows if row.get(column)]
        stamps[column] = max(values) if values else None
    return stamps


def forecast_stamps_from_rows(rows: list[dict]) -> dict:
    """Latest pipeline run behind each forecast line, overall and per tier.

    Same answer as MAX(<line>_generated_at) over the output view for the
    scope, without a second read of that slow view. The stamps are uniform
    YYYY-MM-DDTHH:MM:SSZ strings (bigquery._iso_stamp), so max() on the
    strings is the latest time. A line with no rows in scope stays None.
    The top-level stamps cover every tier (the All customers view, which
    averages the models); `by_tier` is what a page showing one model reads.
    """
    by_tier = {}
    for tier in bigquery_service.FORECAST_TIERS:
        by_tier[tier] = _latest_stamps([row for row in rows if row.get("tier") == tier])
    # When the output table was last rebuilt: the same on every row.
    built = [row["output_built_at"] for row in rows if row.get("output_built_at")]
    return {**_latest_stamps(rows), "output_built_at": max(built) if built else None, "by_tier": by_tier}


def forecast_tiers_from_rows(rows: list[dict]) -> list[dict]:
    """The models in scope, in tier_order, with the label the view gives each."""
    tiers = {}
    for row in rows:
        tier = row.get("tier")
        if tier and tier not in tiers:
            tiers[tier] = {"tier": tier, "tier_label": row.get("tier_label"), "tier_order": row.get("tier_order")}
    return sorted(tiers.values(), key=lambda item: (item["tier_order"] is None, item["tier_order"] or 0, item["tier"]))


# The data-month columns on an output row (bigquery._forecast_output_row).
_DATA_MONTH_COLUMNS = ("current_data_month", "previous_data_month")


def forecast_availability(rows: list[dict]) -> dict:
    """{sku: {tier: {is_available, unavailable_reason, has_initial, has_previous,
    current_data_month, previous_data_month}}} for the rows in scope.

    is_available is the same on every row of a customer x SKU x tier. With
    several customers in scope (All customers) a SKU's tier counts as
    available only when it is for all of them, so the Model dropdown only
    offers a model every customer x SKU in scope has. has_initial /
    has_previous: whether any month has a forecast_initial /
    forecast_previous. Initial is Tier 0's on every tier
    (bigquery.with_tier0_initial), so has_initial is the same on all three. A
    tier can be available with neither: no Initial when the SKU launched after
    the yearly plan was made, no Previous until the SKU has two months
    of sales. current_data_month / previous_data_month: the last sales month
    each line was trained on; with several customers in scope, the latest
    across them (each row still carries its own customer's month, which the
    page's per-customer text reads). None when no row in scope has one.
    """
    availability: dict[str, dict[str, dict]] = {}
    for row in rows:
        sku, tier = row.get("sku"), row.get("tier")
        if not sku or not tier:
            continue
        entry = availability.setdefault(sku, {}).setdefault(
            tier,
            {
                "is_available": True,
                "unavailable_reason": None,
                "has_initial": False,
                "has_previous": False,
                "current_data_month": None,
                "previous_data_month": None,
            },
        )
        if not row.get("is_available"):
            entry["is_available"] = False
            entry["unavailable_reason"] = entry["unavailable_reason"] or row.get("unavailable_reason")
        if row.get("forecast_initial") is not None:
            entry["has_initial"] = True
        if row.get("forecast_previous") is not None:
            entry["has_previous"] = True
        # YYYY-MM-DD strings, so max() on the strings is the latest month.
        for column in _DATA_MONTH_COLUMNS:
            month = row.get(column)
            if month and (entry[column] is None or month > entry[column]):
                entry[column] = month
    return availability


def get_forecast_view(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """One Forecast-page payload: forecast rows, monthly actuals, and overlapping promos.

    Volume only (cartons): the page shows no revenue, so nothing is priced
    and actuals carry no revenue. Forecast rows come from
    aire_forecasting_output with every tier (three rows per customer x SKU x
    month), so the page switches models without a new request; they are
    never added up across tiers. `availability` and `tiers` drive the Model
    picker. Actuals come from v_customer_monthly_sales (not the table's
    actual_quantity_cartons, which repeats on every tier's row); each row's
    actual_status says why a month in the forecast window has no actual
    (missing file / not yet / before the first sale), and the page lines
    actuals up with it by customer x SKU. Promos come from Postgres.
    """
    product_name = product_name or None
    customer_name = customer_name or None
    start_date = start_date or None
    end_date = end_date or None

    filters = {
        "product_name": product_name,
        "customer_name": customer_name,
        "start_date": start_date,
        "end_date": end_date,
    }

    # The reads are independent and each one mostly waits on BigQuery or
    # Postgres, so they run side by side: the page waits for the slowest
    # read instead of the sum of all of them. Both clients are process-wide
    # singletons that are safe to share across threads. .result() re-raises
    # a worker's exception here, so the router's error mapping is unchanged.
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows_job = pool.submit(bigquery_service.get_forecast_output_rows, **filters)
        horizon_job = pool.submit(
            bigquery_service.get_current_horizon,
            product_name=product_name,
            customer_name=customer_name,
        )
        actuals_job = pool.submit(bigquery_service.get_forecast_actuals, **filters)
        promotions_job = pool.submit(promotion_service.list_forecast_promotions, **filters)
        sales_loaded_job = pool.submit(
            bigquery_service.get_sales_loaded_at,
            customer_name=customer_name,
        )
        rows = rows_job.result()
        horizon = horizon_job.result()
        actuals = actuals_job.result()
        promotions = promotions_job.result()
        sales_loaded_at = sales_loaded_job.result()

    return {
        **filters,
        "rows": rows,
        "tiers": forecast_tiers_from_rows(rows),
        "availability": forecast_availability(rows),
        # The whole Current line per tier, not cut by the date filter.
        "horizon": current_horizon_totals(horizon),
        # get_forecast_actuals also feeds the assistant's summary, which
        # prices; the page only needs cartons.
        "actuals": [{key: value for key, value in row.items() if key != "revenue"} for row in actuals],
        "promotions": promotions,
        "freshness": {
            **forecast_stamps_from_rows(rows),
            "latest_sales_loaded_at": sales_loaded_at,
        },
    }


_ALTERNATIVE_REVENUE_COLUMNS = {
    "alt_forecast_current": "alt_forecast_current_revenue",
    "alt_low_80": "alt_low_80_revenue",
    "alt_high_80": "alt_high_80_revenue",
}


def get_forecast_alternatives(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """The forecast without the model's promotions, for months where the Current line uses them.

    Used by the Scenario builder's "Plan my own promotions" view
    (bigquery.get_forecast_alternatives). The cartons are priced at the same
    realised price as the Current line, so switching views changes revenue
    only because the forecast changed.
    """
    filters = {
        "product_name": product_name or None,
        "customer_name": customer_name or None,
        "start_date": start_date or None,
        "end_date": end_date or None,
    }

    with ThreadPoolExecutor(max_workers=2) as pool:
        rows_job = pool.submit(bigquery_service.get_forecast_alternatives, **filters)
        prices_job = pool.submit(
            bigquery_service.get_realised_prices,
            product_name=filters["product_name"],
            customer_name=filters["customer_name"],
        )
        rows = rows_job.result()
        prices = prices_job.result()

    priced = []
    for row in rows:
        price = prices.get((row.get("customer_id"), row.get("sku")))
        revenue = {
            revenue_key: round(row[cartons_key] * price, 2)
            if row.get(cartons_key) is not None and price is not None
            else None
            for cartons_key, revenue_key in _ALTERNATIVE_REVENUE_COLUMNS.items()
        }
        priced.append({**row, **revenue})

    return {**filters, "rows": priced}


def _is_past(stamp: str | None, now: datetime) -> bool:
    if not stamp:
        return False
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")) < now


def get_initial_status() -> dict:
    """Whether each year's Initial Yearly Forecast is still updating or locked.

    Best effort, behind its own endpoint: the note it feeds is extra detail,
    so a failed read logs and returns no years rather than failing the page.
    `locked` is decided here on the server's UTC clock (open while now <=
    lock_at), so a viewer's wrong clock can't flip it.
    """
    try:
        meta = bigquery_service.get_initial_meta()
    except Exception as exc:
        logger.warning("Could not read the Initial Yearly Forecast status: %s", exc)
        return {"years": []}
    now = datetime.now(timezone.utc)
    return {
        "years": [
            {**row, "locked": _is_past(row["lock_at"], now)}
            for row in meta
        ]
    }


# ============================================================
# WRITES
#
# Each write loads a DataFrame into a throwaway staging table
# and MERGEs it in one statement, so the forecast table is never
# left half-updated. The staging table is dropped even on error.
# ============================================================

_MERGE_ACTUALS = """
    MERGE `{target}` t
    USING `{staging}` s
    ON  t.forecast_generated_at IS NULL
    AND t.product_name = s.product_name
    AND t.customer_name = s.customer_name
    AND t.month_year = s.month_year
    WHEN MATCHED THEN UPDATE SET
      quantity_units = s.quantity_units,
      revenue = s.revenue
    WHEN NOT MATCHED THEN INSERT
      (month_year, forecast_generated_at, customer_id, customer_name, product_name,
       promo_type, promotion_mechanic, period_label, voucher, quantity_units, revenue)
    VALUES
      (s.month_year, NULL, s.customer_id, s.customer_name, s.product_name,
       s.promo_type, s.promotion_mechanic, s.period_label, s.voucher, s.quantity_units, s.revenue)
"""

_MERGE_FORECAST = """
    MERGE `{target}` t
    USING `{staging}` s
    ON  t.forecast_generated_at = s.forecast_generated_at
    -- Pre-migration rows have run_type/tier IS NULL; staging rows always
    -- have concrete values (pl_forecast.normalise_rows defaults missing/null
    -- to 'rolling'/0), so a plain equality would never match those old rows
    -- and every refresh would re-INSERT duplicates instead of updating them.
    AND COALESCE(t.run_type, 'rolling') = s.run_type
    AND COALESCE(t.tier, 0) = s.tier
    AND t.product_name = s.product_name
    AND t.customer_name = s.customer_name
    AND t.month_year = s.month_year
    WHEN MATCHED THEN UPDATE SET
      -- Heals a pre-migration NULL to a real value the first time this row
      -- is touched again -- s.run_type/s.tier already equal
      -- COALESCE(t.run_type, 'rolling')/COALESCE(t.tier, 0) by the ON clause
      -- above, so this is a no-op for rows that already had a concrete value.
      run_type = s.run_type,
      tier = s.tier,
      predicted_quantity_units = s.predicted_quantity_units,
      predicted_revenue = s.predicted_revenue
    WHEN NOT MATCHED THEN INSERT
      (month_year, forecast_generated_at, run_type, tier, customer_id, customer_name, product_name,
       promo_type, promotion_mechanic, period_label, voucher,
       predicted_quantity_units, predicted_revenue)
    VALUES
      (s.month_year, s.forecast_generated_at, s.run_type, s.tier, s.customer_id, s.customer_name, s.product_name,
       s.promo_type, s.promotion_mechanic, s.period_label, s.voucher,
       s.predicted_quantity_units, s.predicted_revenue)
"""

_ACTUALS_SCHEMA = [
    bigquery.SchemaField("month_year", "DATE"),
    bigquery.SchemaField("customer_id", "INTEGER"),
    bigquery.SchemaField("customer_name", "STRING"),
    bigquery.SchemaField("product_name", "STRING"),
    *[bigquery.SchemaField(column, "STRING") for column in pl_forecast.PROMO_COLUMNS],
    bigquery.SchemaField("quantity_units", "FLOAT"),
    bigquery.SchemaField("revenue", "FLOAT"),
]

_FORECAST_SCHEMA = [
    bigquery.SchemaField("month_year", "DATE"),
    bigquery.SchemaField("forecast_generated_at", "DATE"),
    bigquery.SchemaField("run_type", "STRING"),
    bigquery.SchemaField("tier", "INTEGER"),
    bigquery.SchemaField("customer_id", "INTEGER"),
    bigquery.SchemaField("customer_name", "STRING"),
    bigquery.SchemaField("product_name", "STRING"),
    *[bigquery.SchemaField(column, "STRING") for column in pl_forecast.PROMO_COLUMNS],
    bigquery.SchemaField("predicted_quantity_units", "FLOAT"),
    bigquery.SchemaField("predicted_revenue", "FLOAT"),
]


def _to_load_frame(df: pd.DataFrame, schema: list[bigquery.SchemaField]) -> pd.DataFrame:
    # pandas dtypes drift (Period months, NaN promos, float customer ids after
    # a concat); pin them to the BigQuery schema so the load job can't reject them.
    frame = df[[field.name for field in schema]].copy()
    frame["month_year"] = frame["month_year"].dt.to_timestamp().dt.date
    for field in schema:
        if field.field_type == "STRING":
            frame[field.name] = frame[field.name].map(pl_forecast.clean_promo).astype(object)
        elif field.field_type == "FLOAT":
            frame[field.name] = pd.to_numeric(frame[field.name]).astype(float)
        elif field.field_type == "INTEGER":
            frame[field.name] = pd.to_numeric(frame[field.name]).astype("Int64")
    return frame


def _merge_via_staging(df: pd.DataFrame, schema: list[bigquery.SchemaField], merge_sql: str) -> int:
    client = get_bigquery_client()
    dataset = FORECAST_TABLE.rsplit(".", 1)[0]
    staging = f"{dataset}._pl_forecast_stage_{uuid.uuid4().hex[:8]}"
    try:
        job_config = bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_TRUNCATE")
        client.load_table_from_dataframe(_to_load_frame(df, schema), staging, job_config=job_config).result()
        job = client.query(merge_sql.format(target=FORECAST_TABLE, staging=staging))
        job.result()
        return job.num_dml_affected_rows or 0
    finally:
        client.delete_table(staging, not_found_ok=True)


def merge_actual_rows(changes: pd.DataFrame) -> int:
    return _merge_via_staging(changes, _ACTUALS_SCHEMA, _MERGE_ACTUALS)


def merge_forecast_rows(forecast: pd.DataFrame) -> int:
    return _merge_via_staging(forecast, _FORECAST_SCHEMA, _MERGE_FORECAST)


# ============================================================
# REFRESH
# ============================================================


def refresh_forecast(
    write: bool = False,
    refresh_actuals: bool = True,
    refresh_yearly: bool = True,
    recompute_all: bool = False,
    params: pl_forecast.ForecastParams | None = None,
    exclude_months: set[str] | None = None,
    uplift_override: dict[str, float] | None = None,
) -> dict:
    """Recompute the forecast from the latest actuals and, when write=True, MERGE it into BigQuery.

    Safe to re-run: with no new sell-out data nothing changes. Without
    write=True it only reads, so it doubles as a preview.
    """
    params = params or pl_forecast.ForecastParams()
    exclude_months = exclude_months or set()
    uplift_override = uplift_override or {}
    pl_forecast.validate_uplift_override(uplift_override)

    rows = pl_forecast.normalise_rows(get_forecast_table_rows())
    notes = []

    actual_changes = pd.DataFrame()
    if refresh_actuals:
        customers = sorted(rows["customer_name"].dropna().unique())
        monthly = pl_forecast.complete_months(get_sellout_weeks(customers))
        actual_changes = pl_forecast.diff_actuals(rows, monthly)
        rows = pl_forecast.apply_actual_changes(rows, actual_changes)
        notes.append(f"actuals: {len(monthly)} complete SKU-months in {SALES_ENRICHED_VIEW}, "
                     f"{len(actual_changes)} changed or new")

    actuals, ignored = pl_forecast.usable_actuals(rows, params, exclude_months)
    notes.append(f"modelling on actuals {actuals['month_year'].min()} .. {actuals['month_year'].max()}; "
                 f"ignored months: {ignored or 'none'}")

    new_run = pl_forecast.next_run(rows, actuals)
    new_run_date = None
    if not new_run.empty:
        new_run_date = new_run["forecast_generated_at"].iloc[0]
        rows = pd.concat([rows, new_run], ignore_index=True)
        notes.append(f"new run {new_run_date}: {len(new_run)} rows")

    new_yearly_run_dates = []
    if refresh_yearly:
        new_yearly_run = pl_forecast.next_yearly_run(rows, actuals)
        if not new_yearly_run.empty:
            new_yearly_run_dates = sorted(new_yearly_run["forecast_generated_at"].unique())
            rows = pd.concat([rows, new_yearly_run], ignore_index=True)
            notes.append(f"new yearly baselines {[str(d) for d in new_yearly_run_dates]}: "
                         f"{len(new_yearly_run)} rows")
    else:
        notes.append("yearly baseline: skipped (refresh_yearly=False)")

    rolling_runs = pl_forecast.runs_to_compute(rows, recompute_all)
    yearly_runs = pl_forecast.yearly_runs_to_compute(rows) if refresh_yearly else []
    notes.append("rolling runs computed: " + ", ".join(str(run) for run in rolling_runs))
    notes.append("yearly runs computed: " + (", ".join(str(run) for run in yearly_runs) or "none"))

    prices = catalog_service.get_product_prices()
    # Pre-filtering rows by run_type before each call -- rather than filtering
    # inside forecast_runs() -- is what keeps a rolling and a yearly run that
    # happen to share a forecast_generated_at date (and target the same
    # months) from being conflated: each call's internal date-match only
    # ever sees rows of its own type. Also scoped to tier 0 -- this app only
    # ever computes its own model's rows, never a Tier 1 row that might
    # share a date/months with one of these.
    rolling_forecast, rolling_notes = pl_forecast.forecast_runs(
        rows[(rows["run_type"] == "rolling") & (rows["tier"] == 0)], actuals, prices,
        rolling_runs, params, uplift_override
    )
    yearly_forecast, yearly_notes = pl_forecast.forecast_runs(
        rows[(rows["run_type"] == "yearly") & (rows["tier"] == 0)], actuals, prices,
        yearly_runs, params, uplift_override
    )
    notes.extend(rolling_notes)
    notes.extend(yearly_notes)
    forecast = pd.concat([rolling_forecast, yearly_forecast], ignore_index=True) \
        if not rolling_forecast.empty or not yearly_forecast.empty else pd.DataFrame()

    written = {"actual_rows": 0, "forecast_rows": 0}
    if write:
        if not actual_changes.empty:
            written["actual_rows"] = merge_actual_rows(actual_changes)
        if not forecast.empty:
            written["forecast_rows"] = merge_forecast_rows(forecast)
        notes.append(f"wrote {written['actual_rows']} actual and {written['forecast_rows']} "
                     f"forecast rows to {FORECAST_TABLE}")

    return {
        "forecast": forecast,
        "actual_changes": actual_changes,
        "new_run": str(new_run_date) if new_run_date else None,
        "new_yearly_runs": [str(d) for d in new_yearly_run_dates],
        "written": written,
        "notes": notes,
    }


def forecast_notification_payload(forecast: pd.DataFrame) -> dict:
    """
    Customers, SKUs and the period covered by one refresh_forecast() run's
    `forecast` rows -- the fields the forecast-pipeline-completed notification
    shows. Pure: scripts/refresh_forecast.py adds updated_at/errors itself,
    since those depend on when and how the run was invoked, not the rows.
    """

    if forecast.empty:
        return {"period_start": None, "period_end": None, "customers": [], "skus": []}

    months = sorted(str(month) for month in forecast["month_year"].dropna().unique())
    return {
        "period_start": months[0] if months else None,
        "period_end": months[-1] if months else None,
        "customers": sorted(forecast["customer_name"].dropna().unique().tolist()),
        "skus": sorted(forecast["product_name"].dropna().unique().tolist()),
    }
