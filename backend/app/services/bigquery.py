import os
import re
from datetime import datetime
import pandas as pd
from google.cloud import bigquery

SKU_RANKING_METRICS = ("volume", "value")
SKU_RANKING_COLUMNS = ["sku", "product_name", "volume", "value", "rank"]
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIOD_COMPARISON_TYPES = ("wow", "mom", "yoy")
DASHBOARD_MODES = ("offline", "online")
DASHBOARD_GRANULARITIES = ("week", "month")
DEFAULT_CUSTOMER = "fairprice" # Fallback when no customer is supplied 

# Read-only reference data
BQFairprice_TABLE = os.environ.get("BQ_FAIRPRICESELLOUT_TABLE", "aire-data.Aire_Data.aireOS_fairprice")

def get_bigquery_client(project="aire-data") -> bigquery.Client:
    return bigquery.Client(project=project)


def _retailer_for(customer: str, mode: str) -> str:
    # Every row's retailer column is ingested as "{customer}_offline" or
    # "{customer}_online" (see mapping_service.apply_existing_mapping), one
    # customer per retailer_family, split into the two dashboard channels.
    return f"{customer}_{mode}"


def _customer_retailers(customer: str) -> list[str]:
    return [_retailer_for(customer, mode) for mode in DASHBOARD_MODES]


def _retailer_family(retailer: str) -> str:
    for suffix in ("_online", "_offline"):
        if retailer.endswith(suffix):
            return retailer[: -len(suffix)]
    return retailer


def _validate_date(value: str | None, field_name: str) -> None:
    if value is not None and not DATE_PATTERN.match(value):
        raise ValueError(f"{field_name} must be in YYYY-MM-DD format")


def get_sku_ranking(
    metric: str = "value",
    order: str = "desc",
    sku: str | None = None,
    mode: str | None = None,
    customer: str = DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    # Ranks SKUs from the client's BigQuery sellout table by total units sold
    # (volume) or total revenue (value). Rows are always restricted to
    # period_type = 'week'. With no start_date/end_date this ranks across all
    # available history — narrowing to a date range (or sku/store/mode)
    # only changes which rows get summed before ranking, not how ranking works.

    if metric not in SKU_RANKING_METRICS:
        raise ValueError(f"metric must be one of {SKU_RANKING_METRICS}")
    if order not in ("asc", "desc"):
        raise ValueError("order must be 'asc' or 'desc'")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")

    sql_order = "ASC" if order == "asc" else "DESC"
    where_clauses = ["sku IS NOT NULL", "period_type = 'week'"]
    query_parameters = []
    if sku:
        where_clauses.append("sku = @sku")
        query_parameters.append(bigquery.ScalarQueryParameter("sku", "STRING", sku))
    if mode:
        where_clauses.append("retailer = @retailer")
        query_parameters.append(
            bigquery.ScalarQueryParameter("retailer", "STRING", _retailer_for(customer, mode))
        )
    else:
        where_clauses.append("retailer IN UNNEST(@retailers)")
        query_parameters.append(
            bigquery.ArrayQueryParameter("retailers", "STRING", _customer_retailers(customer))
        )
    if store:
        where_clauses.append("store_code = @store")
        query_parameters.append(bigquery.ScalarQueryParameter("store", "STRING", store))
    if start_date:
        where_clauses.append("period_start >= @start_date")
        query_parameters.append(bigquery.ScalarQueryParameter("start_date", "DATE", start_date))
    if end_date:
        where_clauses.append("period_start <= @end_date")
        query_parameters.append(bigquery.ScalarQueryParameter("end_date", "DATE", end_date))

    query = f"""
        SELECT
          sku,
          ANY_VALUE(product_name) AS product_name,
          IFNULL(SUM(quantity_units), 0) AS volume,
          IFNULL(SUM(revenue), 0) AS value
        FROM `{BQFairprice_TABLE}`
        WHERE {' AND '.join(where_clauses)}
        GROUP BY sku
        ORDER BY {metric} {sql_order}
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)

    client = get_bigquery_client()
    ranked = client.query(query, job_config=job_config).result().to_dataframe()

    if ranked.empty:
        return pd.DataFrame(columns=SKU_RANKING_COLUMNS)

    ranked["value"] = ranked["value"].round(2)
    ranked = ranked.reset_index(drop=True)
    ranked["rank"] = ranked.index + 1

    return ranked[SKU_RANKING_COLUMNS]


def get_sku_options(customer: str = DEFAULT_CUSTOMER) -> list[dict]:
    # SKUs with real weekly sales data (not scoped to a specific month), for
    # the dashboard's SKU filter dropdown. Restricted to period_type = 'week'
    # like the rest of the dashboard (dashboard-summary, SKU ranking) — a
    # handful of legacy rows exist only as period_type = 'month' with sku set
    # to the product name itself and no revenue (pre-dating real SKU codes).
    # Excluding those keeps one real, sellable entry per product instead of
    # a dead lookalike duplicate for each. Scoped to the selected customer so
    # the dropdown only ever shows SKUs that customer actually sells.
    #
    # Ordered by product line (sku_range, e.g. "Aire Adult Diaper Pants" vs
    # "...Ultra Pants" vs "...Ultra Tape") then by size smallest-to-largest,
    # so the dropdown groups "Aire Adult Pants S/M, L, XL", then the Ultra
    # Pants sizes, then the Ultra Tape sizes, rather than sku-code order.
    query = f"""
        SELECT
          sku,
          ANY_VALUE(product_name) AS product_name,
          ANY_VALUE(sku_range) AS sku_range,
          CASE ANY_VALUE(size)
            WHEN 'S/M' THEN 0
            WHEN 'L' THEN 1
            WHEN 'XL' THEN 2
            ELSE 3
          END AS size_order
        FROM `{BQFairprice_TABLE}`
        WHERE sku IS NOT NULL AND period_type = 'week' AND retailer IN UNNEST(@retailers)
        GROUP BY sku
        ORDER BY sku_range, size_order
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("retailers", "STRING", _customer_retailers(customer))]
    )
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    return df[["sku", "product_name"]].to_dict(orient="records") if not df.empty else []


def get_store_options(customer: str = DEFAULT_CUSTOMER) -> list[dict]:
    # Distinct stores (branches) with real weekly sales data, for the
    # dashboard's Store filter dropdown. Keyed on store_code — a stable
    # per-branch identifier. Scoped to the selected customer's two channels,
    # since different customers (retailer families) have their own store
    # chains.
    query = f"""
        SELECT store_code, ANY_VALUE(store_name) AS store_name
        FROM `{BQFairprice_TABLE}`
        WHERE store_code IS NOT NULL AND period_type = 'week' AND retailer IN UNNEST(@retailers)
        GROUP BY store_code
        ORDER BY store_name
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("retailers", "STRING", _customer_retailers(customer))]
    )
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    return df[["store_code", "store_name"]].to_dict(orient="records") if not df.empty else []


def get_customer_options() -> list[dict]:
    # Distinct top-level customers (retailer families, e.g. "fairprice") for
    # the page-header Customer selector — derived from the retailer column
    # rather than a hardcoded list, so a newly ingested customer (see
    # mapping_service.py's retailer_family) shows up automatically with no
    # dashboard code change. Each row's retailer is ingested as
    # "{family}_offline" or "{family}_online" (see
    # mapping_service.apply_existing_mapping); stripping that known channel
    # suffix recovers the family.
    query = f"""
        SELECT DISTINCT retailer
        FROM `{BQFairprice_TABLE}`
        WHERE retailer IS NOT NULL
    """
    client = get_bigquery_client()
    df = client.query(query).result().to_dataframe()
    if df.empty:
        return []
    families = sorted({_retailer_family(r) for r in df["retailer"]})
    return [{"value": family, "label": family.title()} for family in families]


def _format_last_updated(value) -> str | None:
    """Format a BigQuery loaded_at value as dd/mm/yy hh:mm:ss for the dashboard."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    ts = pd.to_datetime(value, utc=True)
    if pd.isna(ts):
        return None
    # Display in Singapore time so staff see a local wall-clock stamp.
    return ts.tz_convert("Asia/Singapore").strftime("%d/%m/%y %H:%M:%S")


def get_data_freshness() -> dict:
    """
    Latest ingest time (MAX(loaded_at)) per retailer, across every customer.

    Deliberately not scoped to one customer — this feeds the dashboard's
    global dataVersion poll (see useDataFreshness on the frontend), which
    must notice new data for ANY customer, including one just picked up by
    the page-header Customer selector before that selector even has a value
    to scope by. Keyed by the raw retailer string (e.g. "fairprice_offline")
    rather than a mode, since the set of retailers is now open-ended; callers
    look up `f"{customer}_{mode}"` themselves.
    """
    query = f"""
        SELECT
          retailer,
          MAX(loaded_at) AS loaded_at
        FROM `{BQFairprice_TABLE}`
        WHERE retailer IS NOT NULL
        GROUP BY retailer
    """
    client = get_bigquery_client()
    df = client.query(query).result().to_dataframe()
    if df.empty:
        return {}
    return {row["retailer"]: _format_last_updated(row["loaded_at"]) for _, row in df.iterrows()}


def get_dashboard_summary(
    granularity: str = "week",
    sku: str | None = None,
    customer: str = DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    # Revenue/units per store format for the sales dashboard, split into the
    # selected customer's offline/online channels, bucketed by week or by
    # month. Monthly buckets group by FORMAT_DATE('%Y-%m', period_start) and
    # format the label as "%B %Y". All grouping happens here in SQL/pandas so
    # the frontend only renders pre-aggregated numbers. With no start_date/
    # end_date this is an all-time trend; a date range just narrows which
    # period buckets end up in the result.
    if granularity not in DASHBOARD_GRANULARITIES:
        raise ValueError(f"granularity must be one of {DASHBOARD_GRANULARITIES}")
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")

    period_key_expr = (
        "FORMAT_DATE('%Y-%m', period_start)" if granularity == "month" else "period_label"
    )

    where_clauses = ["period_type = 'week'", "retailer IN UNNEST(@retailers)"]
    query_parameters = [
        bigquery.ArrayQueryParameter("retailers", "STRING", _customer_retailers(customer))
    ]
    if sku:
        where_clauses.append("sku = @sku")
        query_parameters.append(bigquery.ScalarQueryParameter("sku", "STRING", sku))
    if store:
        where_clauses.append("store_code = @store")
        query_parameters.append(bigquery.ScalarQueryParameter("store", "STRING", store))
    if start_date:
        where_clauses.append("period_start >= @start_date")
        query_parameters.append(bigquery.ScalarQueryParameter("start_date", "DATE", start_date))
    if end_date:
        where_clauses.append("period_start <= @end_date")
        query_parameters.append(bigquery.ScalarQueryParameter("end_date", "DATE", end_date))

    query = f"""
        SELECT
          retailer,
          store_format AS format,
          {period_key_expr} AS period_key,
          MIN(period_start) AS period_start,
          SUM(revenue) AS revenue,
          SUM(quantity_units) AS units
        FROM `{BQFairprice_TABLE}`
        WHERE {' AND '.join(where_clauses)}
        GROUP BY retailer, format, period_key
        ORDER BY period_start
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)

    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()

    if not df.empty:
        df["revenue"] = df["revenue"].round(2)
        df["period_label"] = (
            df["period_key"].apply(lambda m: datetime.strptime(m, "%Y-%m").strftime("%B %Y"))
            if granularity == "month"
            else df["period_key"]
        )

    return {
        mode: _dashboard_mode_summary(df, _retailer_for(customer, mode)) for mode in DASHBOARD_MODES
    }

def _dashboard_mode_summary(df: pd.DataFrame, retailer: str) -> dict:
    # Splits the pre-aggregated per-period-by-format rows down to one retailer,
    # then reshapes into the three views the dashboard renders: per format, per
    # period (week or month), and per period-and-format.
    if df.empty:
        return {"storeFormats": [], "periodTotal": [], "periodByFormat": []}

    mode_df = df[df["retailer"] == retailer]

    store_formats = (
        mode_df.groupby("format", as_index=False)[["revenue", "units"]]
        .sum()
        .sort_values("revenue", ascending=False)
    )

    # Group by period_label alone (not period_start) — different store formats
    # can have different MIN(period_start) within the same month (e.g. one
    # format's earliest active week in a month is later than another's), so
    # grouping by both would wrongly split one month/week into two rows here.
    period_total = (
        mode_df.groupby("period_label", as_index=False)
        .agg(period_start=("period_start", "min"), revenue=("revenue", "sum"), units=("units", "sum"))
        .sort_values("period_start")
    )

    period_by_format = mode_df.sort_values("period_start")[["period_label", "format", "revenue", "units"]]

    return {
        "storeFormats": store_formats[["format", "revenue", "units"]].to_dict(orient="records"),
        "periodTotal": period_total[["period_label", "period_start", "revenue", "units"]].to_dict(orient="records"),
        "periodByFormat": period_by_format.to_dict(orient="records"),
    }

def _latest_week_start(retailer: str | None) -> pd.Timestamp | None:
    # Most recent week's period_start, optionally scoped to one retailer/
    # channel — offline and online can have different latest-ingest dates
    # (see get_data_freshness), so this is deliberately not scoped globally
    # when a mode is given.
    where_clauses = ["period_type = 'week'"]
    query_parameters = []
    if retailer:
        where_clauses.append("retailer = @retailer")
        query_parameters.append(bigquery.ScalarQueryParameter("retailer", "STRING", retailer))

    query = f"""
        SELECT period_start
        FROM `{BQFairprice_TABLE}`
        WHERE {' AND '.join(where_clauses)}
        ORDER BY period_start DESC
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    return pd.Timestamp(df.iloc[0]["period_start"]) if not df.empty else None

def _month_bounds(anchor: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    start = anchor.replace(day=1)
    end = start + pd.offsets.MonthEnd(0)
    return start, end

def get_default_date_range(
    customer: str = DEFAULT_CUSTOMER, mode: str | None = None, period: str = "month"
) -> dict:
    # Bounds anchored to the latest available week for the given channel
    # (not the wall-clock date) — used as the dashboard's default fetch
    # scope (chart, revenue summary, SKU ranking) when no explicit Date
    # Range filter is active, and by the Filter panel's "This Week"/"This
    # Month" quick buttons. Anchoring to the wall-clock date instead would
    # show an empty dashboard once "today" moves past the last date this
    # table has been loaded with, since this data doesn't update in real
    # time. Unlike _resolve_preset_range's month/year comparisons, this is
    # a display window, not a comparison — it's deliberately NOT truncated
    # to just the days with data, since showing "this month so far" as a
    # (partially empty) full-month window is the intended, non-misleading
    # behavior for a plain filter (there's nothing being compared against
    # it that a partial period could skew).
    month_spans = {"month": 1, "6months": 6, "12months": 12}
    if period not in ("week", *month_spans):
        raise ValueError(f"period must be one of {('week', *month_spans)}")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")

    retailer = _retailer_for(customer, mode) if mode else None
    anchor = _latest_week_start(retailer)
    if anchor is None:
        return {"start": None, "end": None}

    if period == "week":
        start, end = anchor, anchor + pd.Timedelta(days=6)
    else:
        # "Past N months" = the N most recent calendar months INCLUDING the
        # current one — e.g. period="6months" anchored in August spans
        # March 1 through August's month-end, not a rolling 6×30-day window.
        month_start, month_end = _month_bounds(anchor)
        span = month_spans[period]
        start = month_start - pd.DateOffset(months=span - 1)
        end = month_end
    return {"start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d")}


def _resolve_preset_range(comparison_type: str, retailer: str | None):
    anchor = _latest_week_start(retailer)
    if anchor is None:
        return None

    if comparison_type == "wow":
        # Weeks in this table are a consistent 7-day cadence, not
        # just "whatever sorts before it" — a gap would otherwise silently
        # mislabel a non-adjacent week as "previous". A week row is always a
        # complete unit in this data (no partial-week concept), so no
        # truncation is needed here the way month/year comparisons need below.
        current_start = anchor
        current_end = anchor + pd.Timedelta(days=6)
        previous_start = anchor - pd.Timedelta(days=7)
        previous_end = previous_start + pd.Timedelta(days=6)
    else:
        month_start, month_end = _month_bounds(anchor)
        latest_available = anchor + pd.Timedelta(days=6)
        # If the current month isn't fully populated yet (the latest
        # available week doesn't reach the month's last day), comparing the
        # full calendar month against a full prior month/year would be
        # misleading — the "current" side would look artificially low from
        # missing days, not an actual sales drop. Truncate both sides to the
        # same day-count from their respective period starts, so it's always
        # an apples-to-apples "first N days" comparison.
        current_start = month_start
        current_end = min(month_end, latest_available)
        days_covered = (current_end - current_start).days

        if comparison_type == "mom":
            previous_start = month_start - pd.DateOffset(months=1)
        else:  # yoy — same calendar month one year back, not "last month" (that's mom)
            previous_start = month_start - pd.DateOffset(years=1)
        previous_end = previous_start + pd.Timedelta(days=days_covered)

    return current_start, current_end, previous_start, previous_end

def _empty_period_comparison() -> dict:
    return {
        "current": {"start": None, "end": None, "revenue": 0.0, "units": 0.0},
        "previous": {"start": None, "end": None, "revenue": 0.0, "units": 0.0, "available": False},
    }

def get_period_comparison(
    comparison_type: str | None = None,
    current_start: str | None = None,
    current_end: str | None = None,
    previous_start: str | None = None,
    previous_end: str | None = None,
    mode: str | None = None,
    sku: str | None = None,
    customer: str = DEFAULT_CUSTOMER,
    store: str | None = None,
) -> dict:
    # Compares total revenue/units between two periods. comparison_type
    # ("wow"/"mom"/"yoy") auto-derives both ranges from the latest available
    # week for the given customer/channel; otherwise current_start/current_end
    # and previous_start/previous_end are used directly, each pair defaulting
    # to the latest week / one calendar month before the current range when
    # left unset. comparison_type wins if both are somehow supplied — the
    # frontend only ever sends one or the other.
    if comparison_type is not None and comparison_type not in PERIOD_COMPARISON_TYPES:
        raise ValueError(f"comparison_type must be one of {PERIOD_COMPARISON_TYPES}")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")

    retailer = _retailer_for(customer, mode) if mode else None

    if comparison_type:
        resolved = _resolve_preset_range(comparison_type, retailer)
        if resolved is None:
            return _empty_period_comparison()
        cur_start, cur_end, prev_start, prev_end = resolved
    else:
        if current_start and current_end:
            _validate_date(current_start, "current_start")
            _validate_date(current_end, "current_end")
            cur_start, cur_end = pd.Timestamp(current_start), pd.Timestamp(current_end)
        else:
            anchor = _latest_week_start(retailer)
            if anchor is None:
                return _empty_period_comparison()
            cur_start, cur_end = anchor, anchor + pd.Timedelta(days=6)

        if previous_start and previous_end:
            _validate_date(previous_start, "previous_start")
            _validate_date(previous_end, "previous_end")
            prev_start, prev_end = pd.Timestamp(previous_start), pd.Timestamp(previous_end)
        else:
            prev_start = cur_start - pd.DateOffset(months=1)
            prev_end = cur_end - pd.DateOffset(months=1)

    overall_start = min(cur_start, prev_start)
    overall_end = max(cur_end, prev_end)
    where_clauses = ["period_type = 'week'", "period_start BETWEEN @overall_start AND @overall_end"]
    query_parameters = [
        bigquery.ScalarQueryParameter("overall_start", "DATE", overall_start.strftime("%Y-%m-%d")),
        bigquery.ScalarQueryParameter("overall_end", "DATE", overall_end.strftime("%Y-%m-%d")),
        bigquery.ScalarQueryParameter("cur_start", "DATE", cur_start.strftime("%Y-%m-%d")),
        bigquery.ScalarQueryParameter("cur_end", "DATE", cur_end.strftime("%Y-%m-%d")),
        bigquery.ScalarQueryParameter("prev_start", "DATE", prev_start.strftime("%Y-%m-%d")),
        bigquery.ScalarQueryParameter("prev_end", "DATE", prev_end.strftime("%Y-%m-%d")),
    ]
    if retailer:
        where_clauses.append("retailer = @retailer")
        query_parameters.append(bigquery.ScalarQueryParameter("retailer", "STRING", retailer))
    if sku:
        where_clauses.append("sku = @sku")
        query_parameters.append(bigquery.ScalarQueryParameter("sku", "STRING", sku))
    if store:
        where_clauses.append("store_code = @store")
        query_parameters.append(bigquery.ScalarQueryParameter("store", "STRING", store))

    query = f"""
        SELECT
          SUM(IF(period_start BETWEEN @cur_start AND @cur_end, revenue, 0)) AS current_revenue,
          SUM(IF(period_start BETWEEN @cur_start AND @cur_end, quantity_units, 0)) AS current_units,
          SUM(IF(period_start BETWEEN @prev_start AND @prev_end, revenue, 0)) AS previous_revenue,
          SUM(IF(period_start BETWEEN @prev_start AND @prev_end, quantity_units, 0)) AS previous_units,
          SUM(IF(period_start BETWEEN @prev_start AND @prev_end, 1, 0)) AS previous_row_count
        FROM `{BQFairprice_TABLE}`
        WHERE {' AND '.join(where_clauses)}
    """
    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters)
    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()
    row = df.iloc[0] if not df.empty else None

    def _num(value) -> float:
        return round(float(value), 2) if value is not None and not pd.isna(value) else 0.0

    return {
        "current": {
            "start": cur_start.strftime("%Y-%m-%d"),
            "end": cur_end.strftime("%Y-%m-%d"),
            "revenue": _num(row["current_revenue"]) if row is not None else 0.0,
            "units": _num(row["current_units"]) if row is not None else 0.0,
        },
        "previous": {
            "start": prev_start.strftime("%Y-%m-%d"),
            "end": prev_end.strftime("%Y-%m-%d"),
            "revenue": _num(row["previous_revenue"]) if row is not None else 0.0,
            "units": _num(row["previous_units"]) if row is not None else 0.0,
            "available": bool(row["previous_row_count"] > 0) if row is not None else False,
        },
    }
