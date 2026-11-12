import re
from datetime import date, datetime, timezone
from functools import lru_cache
import pandas as pd
from google.cloud import bigquery
from app import config
from app.services import forecast_cache

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Legacy mock table; only forecast_service's out-of-band refresh still writes it.
BQ_FORECAST_TABLE = config.BQ_FORECAST_TABLE
# Final forecast the Forecast page reads (see config.BQ_FORECAST_OUTPUT_VIEW).
BQ_FORECAST_OUTPUT_VIEW = config.BQ_FORECAST_OUTPUT_VIEW
# Closed monthly sell-out. Forecast actuals and realised prices are read here;
# the output view only carries actuals for months inside its forecast window.
BQ_MONTHLY_SALES_VIEW = config.BQ_MONTHLY_SALES_VIEW

# The view has one row per customer x SKU x month x tier: the same three
# models for every SKU, side by side, never a "best model" mixed per month.
# The client builds their own plan on the model they pick, so nothing here
# ranks or blends tiers, and no total may ever add rows of different tiers.
# Tier 0 is available for every SKU, so readers that need one line
# (Inventory, the Assistant, the Scenario builder) use it.
FORECAST_TIERS = ("tier0", "tier1_basic", "tier1_advanced")
DEFAULT_FORECAST_TIER = "tier0"
# The Initial Yearly Forecast is Tier 0's on every model (with_tier0_initial).
INITIAL_TIER = "tier0"
INITIAL_COLUMNS = (
    "forecast_initial",
    "initial_source_model",
    "initial_generated_at",
    "initial_low_80",
    "initial_high_80",
    "initial_range_pct",
    "initial_confidence_band",
)

# Named explicitly, never SELECT *, so columns the pipeline adds later can't
# change the API's shape. All from the view except customer_name /
# product_name, which come from the catalog joins below.
FORECAST_OUTPUT_COLUMNS = [
    "customer_id",
    "customer_name",
    "sku",
    "product_name",
    "month_year",
    "tier",
    "tier_label",
    "tier_order",
    "source_model",
    "is_available",
    "unavailable_reason",
    "months_of_history",
    "forecast_initial",
    "initial_source_model",
    "initial_generated_at",
    "initial_low_80",
    "initial_high_80",
    "forecast_previous",
    "previous_source_model",
    "previous_generated_at",
    "previous_low_80",
    "previous_high_80",
    "forecast_current",
    "current_source_model",
    "current_generated_at",
    "current_low_80",
    "current_high_80",
    "current_backtest_smape",
    "current_confidence_band",
    "month_range_pct",
    "month_confidence_band",
    "xreg_used_typical_promo",
    "promo_mix",
    "actual_status",
    "output_built_at",
    "current_data_month",
    "previous_data_month",
]
# The two above come from the catalog joins, not the output table.
_JOINED_NAME_COLUMNS = ("customer_name", "product_name")
# The output view carries the 80% range for Current only. Previous's comes
# from its own run row in aire_forecasting_runs: the row the view took
# forecast_previous from (same series, month and model, made at
# previous_generated_at).
_PREVIOUS_RUN_COLUMNS = {
    "previous_low_80": "prediction_interval_lower_bound",
    "previous_high_80": "prediction_interval_upper_bound",
}
# Per-month confidence cut-offs, the same as the output view's
# (high_max_range_pct / medium_max_range_pct): half the 80% range as a % of
# the forecast, <= 20 high, <= 50 medium, else low.
MONTH_HIGH_MAX_RANGE_PCT = 20.0
MONTH_MEDIUM_MAX_RANGE_PCT = 50.0
# actual_status: 'reported' (a NULL-free actual; 0 is a real 0),
# 'missing_file' (the customer sent later months but not this one),
# 'not_yet' (after the customer's latest month), 'before_first_sale'.
# The same on every tier's row.
ACTUAL_STATUSES = ("reported", "missing_file", "not_yet", "before_first_sale")

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


def run_query(query: str, query_parameters: list | None = None):
    """Run one read with bound parameters and return its rows (a RowIterator).

    No time limit: the page waits for its forecast rather than giving up.
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters or [])
    return get_bigquery_client().query(query, job_config=job_config).result()


def read_frame(query: str, query_parameters: list | None = None) -> pd.DataFrame:
    """Run one read and return its rows as a DataFrame, downloaded over REST.

    The forecast reads are small, so the BigQuery Storage API (a separate package
    and IAM permission) would gain nothing; turning it off also stops the
    "BigQuery Storage module not found" warning on every query.
    """
    return run_query(query, query_parameters).to_dataframe(create_bqstorage_client=False)


def _read_output_built_at() -> str | None:
    df = read_frame(
        f"SELECT MAX(output_built_at) AS output_built_at FROM `{BQ_FORECAST_OUTPUT_VIEW}`"
    )
    if df.empty:
        return None
    return _iso_stamp(df.iloc[0]["output_built_at"])


def get_output_built_at() -> str | None:
    """When aire_forecasting_output was last rebuilt (re-read at most once a minute)."""
    return forecast_cache.stamp(_read_output_built_at)


def cached_read(key: tuple, load):
    """`load()` shared by overlapping calls with the same key and kept until
    aire_forecasting_output is rebuilt, or 10 minutes (forecast_cache). The
    key must name the read and every argument that changes its rows."""
    return forecast_cache.cached(key, load, get_output_built_at)


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


def _json_bool(value) -> bool | None:
    if value is None or pd.isna(value):
        return None
    return bool(value)


def _json_str(value):
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def month_range(value: float | None, low: float | None, high: float | None) -> tuple[float | None, str | None]:
    """One forecast month's (range_pct, band), the way the output view works
    out month_range_pct / month_confidence_band for Current. No forecast: no
    band; a forecast without a usable range: 'unknown'."""
    if value is None:
        return None, None
    if low is None or high is None or value == 0:
        return None, "unknown"
    pct = round((high - low) / (2 * value) * 100, 1)
    if pct <= MONTH_HIGH_MAX_RANGE_PCT:
        return pct, "high"
    if pct <= MONTH_MEDIUM_MAX_RANGE_PCT:
        return pct, "medium"
    return pct, "low"


def _forecast_output_row(record: dict) -> dict:
    # NULL stays None throughout: a blank forecast line (no initial for a
    # SKU or year without a snapshot, no previous after the first run) must
    # not be charted as zero.
    forecast_previous = _json_number(record.get("forecast_previous"))
    previous_low = _json_number(record.get("previous_low_80"))
    previous_high = _json_number(record.get("previous_high_80"))
    previous_range_pct, previous_band = month_range(forecast_previous, previous_low, previous_high)
    forecast_initial = _json_number(record.get("forecast_initial"))
    initial_low = _json_number(record.get("initial_low_80"))
    initial_high = _json_number(record.get("initial_high_80"))
    initial_range_pct, initial_band = month_range(forecast_initial, initial_low, initial_high)
    return {
        "customer_id": _json_int(record.get("customer_id")),
        "customer_name": _json_str(record.get("customer_name")),
        "sku": _json_str(record.get("sku")),
        "product_name": _json_str(record.get("product_name")),
        "month_year": _iso_date(record.get("month_year")),
        "tier": _json_str(record.get("tier")),
        "tier_label": _json_str(record.get("tier_label")),
        "tier_order": _json_int(record.get("tier_order")),
        "source_model": _json_str(record.get("source_model")),
        # is_available is the same on every row of a SKU + tier.
        "is_available": bool(_json_bool(record.get("is_available"))),
        "unavailable_reason": _json_str(record.get("unavailable_reason")),
        "months_of_history": _json_int(record.get("months_of_history")),
        "forecast_initial": forecast_initial,
        "initial_source_model": _json_str(record.get("initial_source_model")),
        "initial_generated_at": _iso_stamp(record.get("initial_generated_at")),
        # Initial's 80% range is set when the plan is made (same
        # aire_forecasting_initial row as forecast_initial), and its band uses
        # the same cut-offs as Current's and Previous's.
        "initial_low_80": initial_low,
        "initial_high_80": initial_high,
        "initial_range_pct": initial_range_pct,
        "initial_confidence_band": initial_band,
        "forecast_previous": forecast_previous,
        "previous_source_model": _json_str(record.get("previous_source_model")),
        # Not shown to users: the pipeline stores the rebuilt Previous at the
        # Current run's time minus one second. It is only the key for the
        # Previous range join on aire_forecasting_runs.
        "previous_generated_at": _iso_stamp(record.get("previous_generated_at")),
        # Previous's own 80% range (from its run) and that month's band, the
        # same measures Current gets, so the tooltip can show both.
        "previous_low_80": previous_low,
        "previous_high_80": previous_high,
        "previous_range_pct": previous_range_pct,
        "previous_confidence_band": previous_band,
        "forecast_current": _json_number(record.get("forecast_current")),
        "current_source_model": _json_str(record.get("current_source_model")),
        "current_generated_at": _iso_stamp(record.get("current_generated_at")),
        "current_low_80": _json_number(record.get("current_low_80")),
        "current_high_80": _json_number(record.get("current_high_80")),
        "current_backtest_smape": _json_number(record.get("current_backtest_smape")),
        "current_confidence_band": _json_str(record.get("current_confidence_band")),
        # Per month, Current line only: half the 80% range as a % of the
        # forecast, and its band (<= 20 high, <= 50 medium, else low).
        "month_range_pct": _json_number(record.get("month_range_pct")),
        "month_confidence_band": _json_str(record.get("month_confidence_band")),
        # Advanced only: the month's promotion was unfamiliar to the model,
        # so it used the SKU's usual promotion instead.
        "xreg_used_typical_promo": bool(_json_bool(record.get("xreg_used_typical_promo"))),
        "promo_mix": _json_str(record.get("promo_mix")),
        # Why a month has (or has no) actual for this customer x SKU; never
        # turned into a number here, so a missing month can't read as 0.
        "actual_status": _json_str(record.get("actual_status")),
        "output_built_at": _iso_stamp(record.get("output_built_at")),
        # The last sales month each line was trained on, the same on every
        # row of a customer x SKU x tier: Previous is the same model retrained
        # with one month less sales (normally current_data_month - 1). NULL
        # when the tier isn't available; previous_data_month also NULL when
        # the SKU has no Previous (its first sales month is Current's month).
        "current_data_month": _iso_date(record.get("current_data_month")),
        "previous_data_month": _iso_date(record.get("previous_data_month")),
    }


def _actual_row(record: dict) -> dict:
    return {
        "month_year": _iso_date(record.get("month_year")),
        "customer_id": _json_int(record.get("customer_id")),
        "customer_name": record.get("customer_name"),
        # The page lines each actual up with its forecast rows' actual_status
        # (customer x SKU x month), so the SKU comes along.
        "sku": _json_str(record.get("sku")),
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
    # public_customers / public_skus are Datastream's copies of Cloud SQL, which
    # land in the CDC dataset -- not the forecast dataset the output view is in.
    # Read at call time so a test (or a redeploy) can point it elsewhere.
    return config.BQ_CDC_DATASET


def _forecast_dataset() -> str:
    # The pipeline's own tables (runs, training input, model quality) sit
    # beside the output view.
    return BQ_FORECAST_OUTPUT_VIEW.rsplit(".", 1)[0]


# ============================================================
# FORECAST SCOPE (names -> ids)
#
# aire_forecasting_output is a stored table clustered on customer_id, sku,
# tier, and only a filter on those columns with fixed values lets BigQuery
# skip the rest. The page filters by name, so the names are turned into ids
# first, from the same catalog copies the rows are named from.
# ============================================================

def _read_forecast_scope(product_name: str | None, customer_name: str | None) -> dict:
    parts = []
    query_parameters = []
    if customer_name:
        parts.append(
            f"ARRAY(SELECT customer_id FROM `{_catalog_dataset()}.public_customers` "
            "WHERE customer_name = @customer_name) AS customer_ids"
        )
        query_parameters.append(bigquery.ScalarQueryParameter("customer_name", "STRING", customer_name))
    if product_name:
        parts.append(
            f"ARRAY(SELECT sku FROM `{_catalog_dataset()}.public_skus` "
            "WHERE product_name = @product_name) AS skus"
        )
        query_parameters.append(bigquery.ScalarQueryParameter("product_name", "STRING", product_name))
    df = read_frame(f"SELECT {', '.join(parts)}", query_parameters)
    record = df.iloc[0].to_dict() if not df.empty else {}
    return {
        "customer_ids": [int(value) for value in record.get("customer_ids", [])] if customer_name else None,
        "skus": sorted(str(value) for value in record.get("skus", [])) if product_name else None,
    }


def resolve_forecast_scope(product_name: str | None = None, customer_name: str | None = None) -> dict:
    """{customer_ids, skus} for the names a forecast read filters by.

    None for a name not given (every customer / SKU); an empty list for a
    name that matches nothing, so the caller can answer without querying.
    """
    product_name = product_name or None
    customer_name = customer_name or None
    if product_name is None and customer_name is None:
        return {"customer_ids": None, "skus": None}
    return cached_read(
        ("forecast_scope", product_name, customer_name),
        lambda: _read_forecast_scope(product_name, customer_name),
    )


def _scope_filters(scope: dict, prefix: str) -> tuple[list[str], list]:
    where_clauses = []
    query_parameters = []
    if scope["customer_ids"] is not None:
        where_clauses.append(f"{prefix}customer_id IN UNNEST(@customer_ids)")
        query_parameters.append(bigquery.ArrayQueryParameter("customer_ids", "INT64", scope["customer_ids"]))
    if scope["skus"] is not None:
        where_clauses.append(f"{prefix}sku IN UNNEST(@skus)")
        query_parameters.append(bigquery.ArrayQueryParameter("skus", "STRING", scope["skus"]))
    return where_clauses, query_parameters


def _scope_is_empty(scope: dict) -> bool:
    return scope["customer_ids"] == [] or scope["skus"] == []


# The output table is keyed by customer_id + sku; names are joined on from
# the catalog copies for display only. Columns are named, never output.*,
# so a column the pipeline adds can't change the API's shape.
_OUTPUT_TABLE_COLUMNS = [
    column
    for column in FORECAST_OUTPUT_COLUMNS
    if column not in _JOINED_NAME_COLUMNS and column not in _PREVIOUS_RUN_COLUMNS
]


def _previous_run_select() -> str:
    # Blank when the view shows no Previous (e.g. an unavailable tier), so a
    # range never shows without its line.
    return ", ".join(
        f"IF(output.forecast_previous IS NULL, NULL, previous_run.{source}) AS {column}"
        for column, source in _PREVIOUS_RUN_COLUMNS.items()
    )


def _read_forecast_output_rows(
    scope: dict,
    start_date: str | None,
    end_date: str | None,
    tier: str | None,
) -> list[dict]:
    where_clauses, query_parameters = _name_and_date_filters(
        None, None, start_date, end_date, "output.month_year"
    )
    scope_clauses, scope_parameters = _scope_filters(scope, "output.")
    where_clauses += scope_clauses
    query_parameters += scope_parameters
    if tier == INITIAL_TIER:
        where_clauses.append("output.tier = @tier")
        query_parameters.append(bigquery.ScalarQueryParameter("tier", "STRING", tier))
    elif tier is not None:
        # A Tier 1 read still needs Tier 0's rows: they carry its Initial.
        where_clauses.append("output.tier IN (@tier, @initial_tier)")
        query_parameters.append(bigquery.ScalarQueryParameter("tier", "STRING", tier))
        query_parameters.append(bigquery.ScalarQueryParameter("initial_tier", "STRING", INITIAL_TIER))
    query = f"""
        SELECT
          {", ".join(f"output.{column}" for column in _OUTPUT_TABLE_COLUMNS)},
          {_previous_run_select()},
          customer.customer_name,
          product.product_name
        FROM `{BQ_FORECAST_OUTPUT_VIEW}` AS output
        JOIN `{_catalog_dataset()}.public_customers` AS customer
          ON customer.customer_id = output.customer_id
        JOIN `{_catalog_dataset()}.public_skus` AS product
          ON product.sku = output.sku
        LEFT JOIN `{_forecast_dataset()}.aire_forecasting_runs` AS previous_run
          ON previous_run.customer_id = output.customer_id
         AND previous_run.sku = output.sku
         AND previous_run.month_year = output.month_year
         AND previous_run.source_model = output.source_model
         AND previous_run.forecast_generated_at = output.previous_generated_at
         AND NOT previous_run.is_best
        WHERE {" AND ".join(where_clauses)}
        ORDER BY customer.customer_name, product.product_name, output.tier_order, output.month_year
    """
    df = read_frame(query, query_parameters)
    if df.empty:
        return []
    rows = with_tier0_initial([_forecast_output_row(record) for record in df.to_dict(orient="records")])
    return rows if tier is None else [row for row in rows if row["tier"] == tier]


def with_tier0_initial(rows: list[dict]) -> list[dict]:
    """Every tier's Initial Yearly Forecast replaced by Tier 0's for the same
    customer x SKU x month (None when Tier 0 has none).

    The yearly plan is made with the Tier 0 baseline only, whichever model
    the page shows: the pipeline also writes a Tier 1 Initial, but switching
    model must move Previous and Current only, never the plan the year is
    measured against.
    """
    tier0 = {
        (row["customer_id"], row["sku"], row["month_year"]): row
        for row in rows
        if row["tier"] == INITIAL_TIER
    }
    result = []
    for row in rows:
        if row["tier"] == INITIAL_TIER:
            result.append(row)
            continue
        source = tier0.get((row["customer_id"], row["sku"], row["month_year"]), {})
        result.append({**row, **{column: source.get(column) for column in INITIAL_COLUMNS}})
    return result


def get_forecast_output_rows(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    tier: str | None = None,
) -> list[dict]:
    """Forecast rows from aire_forecasting_output, one per customer x SKU x month x tier.

    Cartons only; forecast_service prices them. With no `tier` every tier
    comes back (the Forecast page switches models without a new request);
    callers that add rows up must pass one tier, or the totals triple.
    Shared through forecast_cache; each caller gets its own copy of the rows.
    """
    if tier is not None and tier not in FORECAST_TIERS:
        raise ValueError(f"tier must be one of {', '.join(FORECAST_TIERS)}")
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")
    scope = resolve_forecast_scope(product_name, customer_name)
    if _scope_is_empty(scope):
        return []
    key = (
        "forecast_output_rows",
        _scope_key(scope),
        start_date or None,
        end_date or None,
        tier,
    )
    rows = cached_read(key, lambda: _read_forecast_output_rows(scope, start_date or None, end_date or None, tier))
    return [dict(row) for row in rows]


def _scope_key(scope: dict) -> tuple:
    # Every id in the key, sorted, so one SKU selection never reuses
    # another's rows.
    customer_ids = scope["customer_ids"]
    skus = scope["skus"]
    return (
        tuple(sorted(customer_ids)) if customer_ids is not None else None,
        tuple(sorted(skus)) if skus is not None else None,
    )


# ============================================================
# FORECAST WITHOUT THE MODEL'S PROMOTIONS
#
# In months where the pipeline's Current line comes from ARIMA_PLUS_XREG,
# the forecast already includes the promotion entered for that month. The
# Scenario builder's "Plan my own promotions" view swaps in the model the
# pipeline would have picked without XREG, so planned promotions can be
# added without counting the entered one twice.
#
# "Would have picked" is step 3c of run_monthly_forecast_pipeline with XREG
# taken out: ARIMA_PLUS, unless the series is too short or ARIMA_PLUS is
# inaccurate and Tier 0 is better. Keep these two numbers in step with that
# procedure (tier0_min_history_months, tier0_fallback_smape).
# ============================================================

TIER0_MIN_HISTORY_MONTHS = 6
TIER0_FALLBACK_SMAPE = 50

_FORECAST_ALTERNATIVES_SQL = """
    WITH latest AS (
      SELECT MAX(forecast_generated_at) AS ts
      FROM `{dataset}.aire_forecasting_runs`
    ),
    run AS (
      SELECT r.*
      FROM `{dataset}.aire_forecasting_runs` AS r, latest
      WHERE r.forecast_generated_at = latest.ts
    ),
    xreg_months AS (
      SELECT customer_id, sku, month_year, forecast_generated_at
      FROM run
      WHERE is_best AND source_model = 'tier1_arimax'{scope}
    ),
    history AS (
      SELECT customer_id, sku, COUNT(*) AS months_of_history
      FROM `{dataset}.fc_training_input`
      WHERE TRUE{scope}
      GROUP BY customer_id, sku
    ),
    scored AS (
      SELECT
        x.customer_id,
        x.sku,
        x.month_year,
        x.forecast_generated_at,
        COALESCE(h.months_of_history, 0) AS months_of_history,
        a.customer_id IS NOT NULL AS has_arima,
        t.customer_id IS NOT NULL AS has_tier0,
        qa.smape AS arima_smape,
        qt.smape AS tier0_smape,
        a.predicted_quantity_cartons AS arima_cartons,
        a.prediction_interval_lower_bound AS arima_low,
        a.prediction_interval_upper_bound AS arima_high,
        t.predicted_quantity_cartons AS tier0_cartons,
        t.prediction_interval_lower_bound AS tier0_low,
        t.prediction_interval_upper_bound AS tier0_high
      FROM xreg_months AS x
      LEFT JOIN run AS a
        ON a.source_model = 'tier1_arima' AND NOT a.is_best
       AND a.customer_id = x.customer_id AND a.sku = x.sku AND a.month_year = x.month_year
      LEFT JOIN run AS t
        ON t.source_model = 'tier0_legacy' AND NOT t.is_best
       AND t.customer_id = x.customer_id AND t.sku = x.sku AND t.month_year = x.month_year
      LEFT JOIN history AS h
        ON h.customer_id = x.customer_id AND h.sku = x.sku
      LEFT JOIN `{dataset}.fc_model_quality_views` AS qa
        ON qa.model_name = 'tier1_arima' AND qa.customer_id = x.customer_id AND qa.sku = x.sku
      LEFT JOIN `{dataset}.fc_model_quality_views` AS qt
        ON qt.model_name = 'tier0_legacy' AND qt.customer_id = x.customer_id AND qt.sku = x.sku
    ),
    chosen AS (
      SELECT
        *,
        CASE
          WHEN months_of_history < @min_history_months THEN 'tier0_legacy'
          WHEN NOT has_arima THEN 'tier0_legacy'
          WHEN has_tier0 AND arima_smape > @fallback_smape AND tier0_smape < arima_smape
            THEN 'tier0_legacy'
          ELSE 'tier1_arima'
        END AS alt_source_model
      FROM scored
    ),
    with_names AS (
      SELECT
        c.customer_id,
        customer.customer_name,
        c.sku,
        product.product_name,
        c.month_year,
        c.alt_source_model,
        c.forecast_generated_at AS alt_generated_at,
        IF(c.alt_source_model = 'tier1_arima', c.arima_cartons, c.tier0_cartons) AS alt_forecast_current,
        IF(c.alt_source_model = 'tier1_arima', c.arima_low, c.tier0_low) AS alt_low_80,
        IF(c.alt_source_model = 'tier1_arima', c.arima_high, c.tier0_high) AS alt_high_80,
        IF(c.alt_source_model = 'tier1_arima', c.arima_smape, c.tier0_smape) AS alt_backtest_smape
      FROM chosen AS c
      JOIN `{catalog}.public_customers` AS customer
        ON customer.customer_id = c.customer_id
      JOIN `{catalog}.public_skus` AS product
        ON product.sku = c.sku
    )
"""


def _forecast_alternative_row(record: dict) -> dict:
    return {
        "customer_id": _json_int(record.get("customer_id")),
        "customer_name": _json_str(record.get("customer_name")),
        "sku": _json_str(record.get("sku")),
        "product_name": _json_str(record.get("product_name")),
        "month_year": _iso_date(record.get("month_year")),
        "alt_source_model": _json_str(record.get("alt_source_model")),
        "alt_generated_at": _iso_stamp(record.get("alt_generated_at")),
        "alt_forecast_current": _json_number(record.get("alt_forecast_current")),
        "alt_low_80": _json_number(record.get("alt_low_80")),
        "alt_high_80": _json_number(record.get("alt_high_80")),
        "alt_backtest_smape": _json_number(record.get("alt_backtest_smape")),
    }


def get_forecast_alternatives(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """
    For every customer x SKU x month whose Current line comes from
    ARIMA_PLUS_XREG, the forecast the pipeline would have chosen without it
    (cartons only; forecast_service prices them). Read-only: the runs table
    keeps every model's forecast for the latest run.
    """
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")
    scope = resolve_forecast_scope(product_name, customer_name)
    if _scope_is_empty(scope):
        return []
    key = ("forecast_alternatives", _scope_key(scope), start_date or None, end_date or None)
    rows = cached_read(key, lambda: _read_forecast_alternatives(scope, start_date or None, end_date or None))
    return [dict(row) for row in rows]


_ALTERNATIVE_COLUMNS = [
    "customer_id",
    "customer_name",
    "sku",
    "product_name",
    "month_year",
    "alt_source_model",
    "alt_generated_at",
    "alt_forecast_current",
    "alt_low_80",
    "alt_high_80",
    "alt_backtest_smape",
]


def _read_forecast_alternatives(scope: dict, start_date: str | None, end_date: str | None) -> list[dict]:
    where_clauses, query_parameters = _name_and_date_filters(None, None, start_date, end_date, "month_year")
    # The id filter goes into the runs and training-input CTEs, where the
    # tables are read, not onto the named result at the end.
    scope_clauses, scope_parameters = _scope_filters(scope, "")
    scope_sql = "".join(f" AND {clause}" for clause in scope_clauses)
    query_parameters += scope_parameters
    query_parameters += [
        bigquery.ScalarQueryParameter("min_history_months", "INT64", TIER0_MIN_HISTORY_MONTHS),
        bigquery.ScalarQueryParameter("fallback_smape", "FLOAT64", TIER0_FALLBACK_SMAPE),
    ]
    alternatives_sql = _FORECAST_ALTERNATIVES_SQL.format(
        dataset=_forecast_dataset(), catalog=_catalog_dataset(), scope=scope_sql
    )
    query = f"""
        {alternatives_sql}
        SELECT {", ".join(_ALTERNATIVE_COLUMNS)}
        FROM with_names
        WHERE {" AND ".join(where_clauses)}
          AND alt_forecast_current IS NOT NULL
        ORDER BY customer_name, product_name, month_year
    """
    df = read_frame(query, query_parameters)
    if df.empty:
        return []
    return [_forecast_alternative_row(record) for record in df.to_dict(orient="records")]


def get_current_horizon(
    product_name: str | None = None,
    customer_name: str | None = None,
) -> list[dict]:
    """Cartons on each customer x SKU's whole Current line, per tier.

    The Current line runs 12 months from each series' own first forecast
    month, which the page's date filter can cut short (a Jan-Dec view of a
    line that runs Sep-Aug). The "Next 12 months" total needs every month,
    so it is read here with no date filter. One row per tier x customer x
    SKU, priced by forecast_service.
    """
    scope = resolve_forecast_scope(product_name, customer_name)
    if _scope_is_empty(scope):
        return []
    rows = cached_read(("current_horizon", _scope_key(scope)), lambda: _read_current_horizon(scope))
    return [dict(row) for row in rows]


def _read_current_horizon(scope: dict) -> list[dict]:
    where_clauses, query_parameters = _scope_filters(scope, "")
    where_clauses.append("forecast_current IS NOT NULL")
    query = f"""
        SELECT tier, customer_id, sku, SUM(forecast_current) AS cartons, COUNT(*) AS months
        FROM `{BQ_FORECAST_OUTPUT_VIEW}`
        WHERE {" AND ".join(where_clauses)}
        GROUP BY tier, customer_id, sku
    """
    df = read_frame(query, query_parameters)
    return [
        {
            "tier": _json_str(record.get("tier")),
            "customer_id": _json_int(record.get("customer_id")),
            "sku": _json_str(record.get("sku")),
            "cartons": _json_number(record.get("cartons")),
            "months": _json_int(record.get("months")),
        }
        for record in df.to_dict(orient="records")
    ]


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
    df = forecast_cache.single_flight(
        ("realised_prices", product_name or None, customer_name or None),
        lambda: read_frame(query, query_parameters),
    )

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
          sku,
          product_name,
          period_start AS month_year,
          quantity_cartons,
          revenue
        FROM `{BQ_MONTHLY_SALES_VIEW}`
        WHERE {" AND ".join(where_clauses)}
        ORDER BY customer_name, product_name, period_start
    """
    # Not cached: actuals move when sales load, not when the forecast is
    # rebuilt. Overlapping identical reads still share one query.
    df = forecast_cache.single_flight(
        ("forecast_actuals", product_name or None, customer_name or None, start_date or None, end_date or None),
        lambda: read_frame(query, query_parameters),
    )
    if df.empty:
        return []
    return [_actual_row(record) for record in df.to_dict(orient="records")]


def get_forecast_options() -> dict:
    """Product/customer lists and the date-picker bounds for the forecast filters.

    Shared through forecast_cache like the forecast rows (the output side
    only changes when the table is rebuilt).
    """
    options = cached_read(("forecast_options",), _read_forecast_options)
    return {**options, "products": list(options["products"]), "customers": list(options["customers"])}


def _read_forecast_options() -> dict:
    # Product/customer lists and the picker bounds come from both the
    # forecast output and actuals, so a year that only exists on one side is
    # still selectable (e.g. 2024 actuals before the first forecast month).
    # Grouped in BigQuery so only one row per customer x product comes back,
    # not every month of both.
    query = f"""
        WITH options AS (
          SELECT
            product.product_name,
            customer.customer_name,
            output.month_year
          FROM `{BQ_FORECAST_OUTPUT_VIEW}` AS output
          JOIN `{_catalog_dataset()}.public_customers` AS customer
            ON customer.customer_id = output.customer_id
          JOIN `{_catalog_dataset()}.public_skus` AS product
            ON product.sku = output.sku
          UNION ALL
          SELECT
            product_name,
            customer_name,
            period_start AS month_year
          FROM `{BQ_MONTHLY_SALES_VIEW}`
        )
        SELECT
          product_name,
          customer_name,
          MIN(month_year) AS first_month,
          MAX(month_year) AS last_month
        FROM options
        GROUP BY product_name, customer_name
    """
    df = read_frame(query)
    if df.empty:
        return {
            "products": [],
            "customers": [],
            "start_date": None,
            "end_date": None,
        }

    months = pd.concat([df["first_month"], df["last_month"]]).dropna()
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
    rows it already fetched, so the output table is read once per page
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
    df = forecast_cache.single_flight(
        ("sales_loaded_at", customer_name),
        lambda: read_frame(query, query_parameters),
    )
    if df.empty:
        return None
    return _iso_stamp(df.iloc[0]["latest_sales_loaded_at"])


# A month a customer never sent: between its first and latest complete month
# with any sales row, a month with none. The same months the chart marks
# actual_status 'missing_file', read from the actuals the Actual line uses.
# All customers and all history, whatever the page's filters.
_MISSING_MONTHS_SQL = """
    WITH sent AS (
      SELECT customer_id, DATE_TRUNC(period_start, MONTH) AS month_year
      FROM `{view}`
      -- The current month is still filling up.
      WHERE period_start < DATE_TRUNC(CURRENT_DATE(), MONTH)
      GROUP BY customer_id, month_year
    ),
    span AS (
      SELECT customer_id, MIN(month_year) AS first_month, MAX(month_year) AS last_month
      FROM sent
      GROUP BY customer_id
    )
    SELECT span.customer_id, customer.customer_name, month AS month_year
    FROM span
    CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(span.first_month, span.last_month, INTERVAL 1 MONTH)) AS month
    JOIN `{catalog}.public_customers` AS customer
      ON customer.customer_id = span.customer_id
    LEFT JOIN sent
      ON sent.customer_id = span.customer_id AND sent.month_year = month
    WHERE sent.customer_id IS NULL
    ORDER BY customer.customer_name, month_year
"""
# A small read behind a best-effort note: it gives up rather than hold the panel.
MISSING_MONTHS_TIMEOUT_MS = 30_000


def _read_missing_months() -> list[dict]:
    query = _MISSING_MONTHS_SQL.format(view=BQ_MONTHLY_SALES_VIEW, catalog=_catalog_dataset())
    job_config = bigquery.QueryJobConfig(job_timeout_ms=MISSING_MONTHS_TIMEOUT_MS)
    # Over REST, like read_frame: the list is small.
    df = get_bigquery_client().query(query, job_config=job_config).result().to_dataframe(create_bqstorage_client=False)
    return [
        {
            "customer_id": _json_int(record["customer_id"]),
            "customer_name": _json_str(record["customer_name"]),
            "month_year": _iso_date(record["month_year"]),
        }
        for record in df.to_dict(orient="records")
    ]


def get_missing_months() -> list[dict]:
    """Every customer x month with no sales file, oldest first per customer
    (customer_id, customer_name, month_year 'YYYY-MM-DD'). Shared by
    overlapping calls and cached like the forecast reads (cached_read)."""
    return cached_read(("missing_months",), _read_missing_months)


def get_initial_meta() -> list[dict]:
    """One row per Initial Yearly Forecast year: when it locks and when it was last rebuilt.

    aire_forecasting_initial_meta is written by Sandra's procedures (one row
    per forecast_year, timestamps in UTC). The dataset is read at call time so
    a test or redeploy can point it elsewhere. 2026 was backfilled outside the
    procedure, so it has no row. data_cutoff is the last sales month the plan
    learned from (refresh_initial_if_needed sets it on every build), for the
    "Fixed plan" note.
    """
    query = f"""
        SELECT forecast_year, lock_at, refreshed_at, data_cutoff
        FROM `{config.BQ_FORECAST_DATASET}.aire_forecasting_initial_meta`
        ORDER BY forecast_year
    """
    df = read_frame(query)
    return [
        {
            "forecast_year": int(record["forecast_year"]),
            "lock_at": _iso_stamp(record["lock_at"]),
            "refreshed_at": _iso_stamp(record["refreshed_at"]),
            "data_cutoff": _iso_date(record["data_cutoff"]),
        }
        for record in df.to_dict(orient="records")
        if not pd.isna(record["forecast_year"])
    ]
