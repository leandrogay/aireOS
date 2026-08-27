import os
import re
from pathlib import Path
from datetime import datetime
import pandas as pd
from google.cloud import bigquery

SKU_RANKING_METRICS = ("volume", "value")
SKU_RANKING_COLUMNS = ["sku", "product_name", "volume", "value", "rank"]
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
WEEK_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Read-only reference data
BQFairprice_TABLE = os.environ.get("BQ_FAIRPRICESELLOUT_TABLE", "aire-data.Aire_Data.aireOS_fairprice")

def get_bigquery_client(project="aire-data") -> bigquery.Client:
    return bigquery.Client(project=project)

def get_available_ranking_months() -> list[str]:
    # Distinct calendar months (YYYY-MM, most recent first) with weekly sellout data, derived from each week's start date. Powers the month picker on the SKU ranking view.
    query = f"""
        SELECT DISTINCT FORMAT_DATE('%Y-%m', period_start) AS month
        FROM `{BQFairprice_TABLE}`
        WHERE period_type = 'week'
        ORDER BY month DESC
    """
    client = get_bigquery_client()
    df = client.query(query).result().to_dataframe()
    return df["month"].tolist() if not df.empty else []


def get_available_ranking_weeks(month: str) -> list[dict]:
    # Distinct weeks within the given calendar month, labelled "Week 1","Week 2", etc. relative to that month. Powers the week picker that lets staff drill from a month into a single week. The table's own period_label numbers weeks continuously across the whole year (e.g. "Week 32" in early August), so it's not used here, the week number is computed from each week's ordinal position within the selected month instead.
    if not month or not MONTH_PATTERN.match(month):
        raise ValueError("month must be in YYYY-MM format")

    query = f"""
        SELECT DISTINCT period_start
        FROM `{BQFairprice_TABLE}`
        WHERE period_type = 'week' AND FORMAT_DATE('%Y-%m', period_start) = @month
        ORDER BY period_start
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("month", "STRING", month)]
    )

    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()

    if df.empty:
        return []

    return [
        {
            "value": str(row["period_start"]),
            "label": f"Week {i} ({pd.to_datetime(row['period_start']).strftime('%d-%m-%Y')})",
        }
        for i, (_, row) in enumerate(df.iterrows(), start=1)
    ]


def get_sku_ranking(
    metric: str = "value", order: str = "desc", month: str | None = None, week: str | None = None
) -> pd.DataFrame:
    # Ranks SKUs from the client's BigQuery sellout table by total units sold (volume) or total revenue (value), for a single calendar month or, optionally, a single week within it. A month is required and rows are always restricted to period_type = 'week'. Weeks are bucketed into the calendar month their start date falls in.
    
    if metric not in SKU_RANKING_METRICS:
        raise ValueError(f"metric must be one of {SKU_RANKING_METRICS}")
    if order not in ("asc", "desc"):
        raise ValueError("order must be 'asc' or 'desc'")
    if not month or not MONTH_PATTERN.match(month):
        raise ValueError("month must be in YYYY-MM format")
    if week is not None and not WEEK_PATTERN.match(week):
        raise ValueError("week must be in YYYY-MM-DD format")

    sql_order = "ASC" if order == "asc" else "DESC"
    where_clauses = [
        "sku IS NOT NULL",
        "period_type = 'week'",
        "FORMAT_DATE('%Y-%m', period_start) = @month",
    ]
    query_parameters = [bigquery.ScalarQueryParameter("month", "STRING", month)]
    if week:
        where_clauses.append("period_start = @week")
        query_parameters.append(bigquery.ScalarQueryParameter("week", "DATE", week))

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


DASHBOARD_RETAILERS = {"offline": "fairprice_offline", "online": "fairprice_online"}
DASHBOARD_GRANULARITIES = ("week", "month")


def get_dashboard_summary(granularity: str = "week") -> dict:
    # Revenue/units per store format for the sales dashboard, split into offline
    # (fairprice_offline) and online (fairprice_online), bucketed by week or by
    # month. Monthly buckets reuse the same FORMAT_DATE('%Y-%m', period_start)
    # grouping and "%B %Y" label formatting already established for the SKU
    # ranking's month picker (get_available_ranking_months / sales.py's /months
    # route), so both views agree on what "month" means for this table. All
    # grouping happens here in SQL/pandas so the frontend only renders
    # pre-aggregated numbers.
    if granularity not in DASHBOARD_GRANULARITIES:
        raise ValueError(f"granularity must be one of {DASHBOARD_GRANULARITIES}")

    period_key_expr = (
        "FORMAT_DATE('%Y-%m', period_start)" if granularity == "month" else "period_label"
    )

    query = f"""
        SELECT
          retailer,
          store_format AS format,
          {period_key_expr} AS period_key,
          MIN(period_start) AS period_start,
          SUM(revenue) AS revenue,
          SUM(quantity_units) AS units
        FROM `{BQFairprice_TABLE}`
        WHERE period_type = 'week'
          AND retailer IN UNNEST(@retailers)
        GROUP BY retailer, format, period_key
        ORDER BY period_start
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ArrayQueryParameter("retailers", "STRING", list(DASHBOARD_RETAILERS.values()))
        ]
    )

    client = get_bigquery_client()
    df = client.query(query, job_config=job_config).result().to_dataframe()

    if not df.empty:
        df["revenue"] = df["revenue"].round(2)
        df["period_label"] = (
            df["period_key"].apply(lambda m: datetime.strptime(m, "%Y-%m").strftime("%B %Y"))
            if granularity == "month"
            else df["period_key"]
        )

    return {mode: _dashboard_mode_summary(df, retailer) for mode, retailer in DASHBOARD_RETAILERS.items()}


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
        "periodTotal": period_total[["period_label", "revenue", "units"]].to_dict(orient="records"),
        "periodByFormat": period_by_format.to_dict(orient="records"),
    }