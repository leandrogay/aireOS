"""
BigQuery reads/writes for the P&L forecast, and the refresh entrypoint.

The Forecast page reads BQ_FORECAST_TABLE (actual rows have
forecast_generated_at NULL; forecast rows carry the run date and a run_type
of 'rolling' or 'yearly' -- see pl_forecast.py's FORECAST RUNS section for
what those mean). This module:

  1. rebuilds the actual rows from the FairPrice sell-out table
     (BQFairprice_TABLE, read-only) -- complete months only,
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

import os
import uuid

import pandas as pd
from google.cloud import bigquery

from app.services import catalog_service, pl_forecast
from app.services.bigquery import BQFairprice_TABLE, get_bigquery_client

FORECAST_TABLE = os.environ.get("BQ_FORECAST_TABLE", "aire-data.Aire_Data.forecasting_output_xianhui_mock")


# ============================================================
# READS
# ============================================================

# Weekly sell-out per customer x SKU. The sell-out table has two kinds of
# duplicates that would double the numbers if summed as-is:
#   - the 2024 and 2025 files were each loaded twice (identical rows),
#   - the 2026 files overlap (Jan-Aug and Jan-Sep), so for every retailer-week
#     only the most recently loaded file is kept.
# Rows that differ only by uom are real and are summed.
_SELLOUT_WEEKS_QUERY = """
    WITH deduplicated AS (
      SELECT DISTINCT period_start, retailer, store_code, sku, uom, product_name,
                      quantity_units, revenue, source_file, loaded_at
      FROM `{sellout_table}`
      WHERE period_type = 'week'
        AND product_name IS NOT NULL
        AND REGEXP_EXTRACT(retailer, r'^(.*)_(?:offline|online)$') IN UNNEST(@customers)
    ),
    latest_file AS (
      SELECT * FROM deduplicated
      QUALIFY loaded_at = MAX(loaded_at) OVER (PARTITION BY retailer, period_start)
    )
    SELECT
      period_start,
      REGEXP_EXTRACT(retailer, r'^(.*)_(?:offline|online)$') AS customer_name,
      product_name,
      SUM(quantity_units) AS quantity_units,
      ROUND(SUM(revenue), 2) AS revenue
    FROM latest_file
    GROUP BY period_start, customer_name, product_name
"""


def get_forecast_table_rows() -> pd.DataFrame:
    client = get_bigquery_client()
    return client.query(f"SELECT * FROM `{FORECAST_TABLE}`").result().to_dataframe()


def get_sellout_weeks(customers: list[str]) -> pd.DataFrame:
    """Deduplicated weekly sell-out for the given customers (online + offline summed)."""
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("customers", "STRING", customers)]
    )
    client = get_bigquery_client()
    query = _SELLOUT_WEEKS_QUERY.format(sellout_table=BQFairprice_TABLE)
    return client.query(query, job_config=job_config).result().to_dataframe()


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
        notes.append(f"actuals: {len(monthly)} complete SKU-months in {BQFairprice_TABLE}, "
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
