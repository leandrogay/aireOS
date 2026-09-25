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

from app.services import catalog_service, customer_service, inventory_forecast, pl_forecast
from app.services.bigquery import BQFairprice_TABLE, get_bigquery_client

FORECAST_TABLE = os.environ.get("BQ_FORECAST_TABLE", "aire-data.Aire_Data.forecasting_output_xianhui_mock")
INVENTORY_METRICS_TABLE = os.environ.get("BQ_INVENTORY_METRICS_TABLE", "aire-data.Aire_Data.inventory_metrics")
INVENTORY_POSITION_TABLE = os.environ.get(
    "BQ_INVENTORY_POSITION_TABLE", "aire-data.Aire_Data.forecasting_inventory_position"
)


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


def get_inventory_metrics_rows() -> pd.DataFrame:
    """Every row of the externally-ingested inventory_metrics table, read-only.

    Small EAV table (see app/services/inventory_forecast.py for the shape),
    so an unfiltered read is simplest -- same style as get_forecast_table_rows().
    """
    client = get_bigquery_client()
    return client.query(f"SELECT * FROM `{INVENTORY_METRICS_TABLE}`").result().to_dataframe()


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

_MERGE_INVENTORY = """
    MERGE `{target}` t
    USING `{staging}` s
    ON  t.month_year = s.month_year
    AND t.customer_name = s.customer_name
    AND t.product_name = s.product_name
    WHEN MATCHED THEN UPDATE SET
      customer_id = s.customer_id,
      opening_inventory = s.opening_inventory,
      actual_sell_in = s.actual_sell_in,
      recommended_sell_in = s.recommended_sell_in,
      actual_sell_out = s.actual_sell_out,
      forecast_sell_out = s.forecast_sell_out,
      actual_closing_inventory = s.actual_closing_inventory,
      predicted_closing_inventory = s.predicted_closing_inventory,
      inventory_position = s.inventory_position,
      -- Captured once, the moment an actual first arrives (t.predicted_closing_inventory
      -- is still whatever the previous refresh predicted). Every refresh after that,
      -- predicted_closing_inventory is already NULL on t for that month, so this falls
      -- through to ELSE and the frozen variance is never overwritten.
      inventory_variance = CASE
        WHEN s.actual_closing_inventory IS NOT NULL AND t.predicted_closing_inventory IS NOT NULL
          THEN s.actual_closing_inventory - t.predicted_closing_inventory
        ELSE t.inventory_variance
      END
    WHEN NOT MATCHED THEN INSERT
      (month_year, customer_id, customer_name, product_name, opening_inventory,
       actual_sell_in, recommended_sell_in, actual_sell_out, forecast_sell_out,
       actual_closing_inventory, predicted_closing_inventory, inventory_position,
       inventory_variance)
    VALUES
      (s.month_year, s.customer_id, s.customer_name, s.product_name, s.opening_inventory,
       s.actual_sell_in, s.recommended_sell_in, s.actual_sell_out, s.forecast_sell_out,
       s.actual_closing_inventory, s.predicted_closing_inventory, s.inventory_position,
       NULL)
"""

_INVENTORY_SCHEMA = [
    bigquery.SchemaField("month_year", "DATE"),
    bigquery.SchemaField("customer_id", "INTEGER"),
    bigquery.SchemaField("customer_name", "STRING"),
    bigquery.SchemaField("product_name", "STRING"),
    bigquery.SchemaField("opening_inventory", "FLOAT"),
    bigquery.SchemaField("actual_sell_in", "FLOAT"),
    bigquery.SchemaField("recommended_sell_in", "FLOAT"),
    bigquery.SchemaField("actual_sell_out", "FLOAT"),
    bigquery.SchemaField("forecast_sell_out", "FLOAT"),
    bigquery.SchemaField("actual_closing_inventory", "FLOAT"),
    bigquery.SchemaField("predicted_closing_inventory", "FLOAT"),
    bigquery.SchemaField("inventory_position", "FLOAT"),
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


def merge_inventory_rows(positions: pd.DataFrame, name_to_customer_id: dict[str, int]) -> int:
    frame = positions.copy()
    frame["customer_id"] = frame["customer_name"].map(name_to_customer_id)
    return _merge_via_staging(frame, _INVENTORY_SCHEMA, _MERGE_INVENTORY)


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


# ============================================================
# INVENTORY POSITION
#
# Reuses the sell-out actuals + model already maintained by
# refresh_forecast() above (via BQ_FORECAST_TABLE), instead of
# re-deriving a second sell-out forecast from inventory_metrics --
# one sell-out forecast, not two that could quietly disagree.
# ============================================================


def _sellout_forecast_by_group(
    actuals: pd.DataFrame,
    uplifts: dict[str, float],
    params: pl_forecast.ForecastParams,
    horizon_months: int,
) -> dict[tuple, dict]:
    forecasts = {}
    for group, history in actuals.groupby(pl_forecast.GROUP_KEY):
        history = history.set_index("month_year").sort_index()
        last_actual = history.index.max()
        months = list(pd.period_range(last_actual + 1, last_actual + horizon_months, freq="M"))
        forecast = pl_forecast.forecast_sku(history, {}, months, uplifts, params)
        forecasts[group] = dict(zip(forecast["month_year"], forecast["total_sell_out"]))
    return forecasts


def refresh_inventory_position(
    write: bool = False,
    inventory_params: inventory_forecast.InventoryParams | None = None,
    forecast_params: pl_forecast.ForecastParams | None = None,
) -> dict:
    """Recompute actual/predicted closing inventory and recommended sell-in from
    inventory_metrics and, when write=True, MERGE it into INVENTORY_POSITION_TABLE.

    Safe to re-run like refresh_forecast(): predicted values are recomputed every
    time, actual values (once they exist) simply get re-confirmed, and
    inventory_variance is only ever set once by the MERGE itself (see
    _MERGE_INVENTORY).
    """
    inventory_params = inventory_params or inventory_forecast.InventoryParams()
    forecast_params = forecast_params or pl_forecast.ForecastParams()
    notes = []

    inv_rows = get_inventory_metrics_rows()
    if inv_rows.empty:
        notes.append(f"no rows in {INVENTORY_METRICS_TABLE}")
        return {"positions": pd.DataFrame(), "written": {"inventory_rows": 0}, "notes": notes}

    skus = sorted(inv_rows["sku"].dropna().unique())
    customer_ids = sorted(int(c) for c in inv_rows["customer_id"].dropna().unique())
    sku_to_product = catalog_service.get_product_names_for_skus(skus)
    customer_to_name = customer_service.get_customer_names(customer_ids)
    notes.append(
        f"resolved {len(sku_to_product)}/{len(skus)} skus, "
        f"{len(customer_to_name)}/{len(customer_ids)} customers"
    )

    pivoted = inventory_forecast.pivot_inventory_metrics(inv_rows, sku_to_product, customer_to_name)
    if pivoted.empty:
        notes.append("no inventory_metrics rows resolved to a known sku/customer")
        return {"positions": pd.DataFrame(), "written": {"inventory_rows": 0}, "notes": notes}

    forecast_rows = pl_forecast.normalise_rows(get_forecast_table_rows())
    actuals, ignored = pl_forecast.usable_actuals(forecast_rows, forecast_params, exclude_months=set())
    uplifts = pl_forecast.estimate_uplifts(actuals, forecast_params)
    # A little extra horizon beyond what build_all_inventory_positions needs so a
    # month it rolls into is never missing a forecast purely from an off-by-a-bit
    # misalignment between inventory_metrics' latest month and the sell-out actuals'.
    sellout_forecast = _sellout_forecast_by_group(
        actuals, uplifts, forecast_params, inventory_params.horizon_months + 3
    )
    notes.append(f"sell-out forecast built for {len(sellout_forecast)} product/customer groups; "
                 f"ignored months: {ignored or 'none'}")

    positions = inventory_forecast.build_all_inventory_positions(pivoted, sellout_forecast, inventory_params)
    group_count = positions[pl_forecast.GROUP_KEY].drop_duplicates().shape[0] if not positions.empty else 0
    notes.append(f"built inventory positions for {group_count} product/customer groups, {len(positions)} rows")

    written = {"inventory_rows": 0}
    if write and not positions.empty:
        name_to_customer_id = {name: customer_id for customer_id, name in customer_to_name.items()}
        written["inventory_rows"] = merge_inventory_rows(positions, name_to_customer_id)
        notes.append(f"wrote {written['inventory_rows']} rows to {INVENTORY_POSITION_TABLE}")

    return {"positions": positions, "written": written, "notes": notes}
