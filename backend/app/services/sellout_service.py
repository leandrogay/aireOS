"""Persist and read sell-out rows in the normalised Cloud SQL schema.

Cloud SQL is the operational source of truth for sell-out -- BigQuery's
public_sellout is a Datastream CDC replica of this same table, which the
Dashboard and Inventory used to read instead, with up to 15 minutes of
replication lag. This module is both ends: ingestion writes (below) and the
reads that used to live in bigquery.py (further down).
"""

import datetime
import re
from collections import Counter
from functools import lru_cache

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app import config
from app.services import catalog_service, sql


class SelloutLoadError(RuntimeError):
    """Validated rows could not be stored atomically in Cloud SQL."""


BUSINESS_KEY = ("retailer", "store_code", "sku", "period_start", "period_type")
SELLOUT_COLUMNS = (
    "retailer_id",
    "period_start",
    "period_end",
    "period_type",
    "store_code",
    "sku",
    "quantity_units",
    "revenue",
    "source_file",
    "loaded_at",
    "data_source",
)
_BULK_UPSERT_THRESHOLD = 100
_BULK_UPSERT_BATCH_SIZE = 500


def _consolidate_records(records: list[dict]) -> list[dict]:
    """Combine source rows that map to the same sell-out business record.

    FairPrice can report the same product/store/period under both CAR and EA
    sales UOMs. quantity_units is already supplied in EA, so when UOM is not
    part of the agreed fact schema the lossless representation is one row with
    additive quantity and revenue.
    """
    consolidated: dict[tuple, dict] = {}
    for row in records:
        key = tuple(row[field] for field in BUSINESS_KEY)
        current = consolidated.get(key)
        if current is None:
            consolidated[key] = dict(row)
            continue

        for metric in ("quantity_units", "revenue"):
            left = current.get(metric)
            right = row.get(metric)
            if left is None:
                current[metric] = right
            elif right is not None:
                current[metric] = left + right

        # The SKU master has one UOM. Prefer EA when the source supplies both
        # EA and CAR for a quantity that is explicitly measured in EA.
        if str(row.get("uom") or "").upper() == "EA":
            current["uom"] = row["uom"]

    return list(consolidated.values())


def _prepare_records(dataframe: pd.DataFrame) -> tuple[list[dict], int]:
    """Normalise types and consolidate rows exactly as the database load will."""
    input_records = (
        dataframe.astype(object)
        .where(dataframe.notna(), None)
        .to_dict("records")
    )
    records = _consolidate_records(input_records)
    for row in records:
        for field in ("period_start", "period_end"):
            value = row.get(field)
            if isinstance(value, str):
                row[field] = datetime.date.fromisoformat(value)
        if row.get("pack_size") is not None:
            row["pack_size"] = int(row["pack_size"])
        for field in ("quantity_units", "revenue"):
            if row.get(field) is not None:
                row[field] = float(row[field])
    return records, len(input_records) - len(records)


def summarize_clean_rows(dataframe: pd.DataFrame) -> dict:
    """Return the exact dry-run counts that ``load_clean_rows`` will use."""
    if dataframe.empty:
        return {
            "rows_input": 0,
            "rows_stored": 0,
            "rows_consolidated": 0,
            "retailers": {},
            "sku_count": 0,
            "first_period": None,
            "last_period": None,
        }

    records, rows_consolidated = _prepare_records(dataframe)
    periods = [row["period_start"] for row in records]
    return {
        "rows_input": len(dataframe),
        "rows_stored": len(records),
        "rows_consolidated": rows_consolidated,
        "retailers": dict(
            sorted(Counter(row["retailer"] for row in records).items())
        ),
        "sku_count": len({str(row["sku"]) for row in records}),
        "first_period": min(periods),
        "last_period": max(periods),
    }


def cloud_sql_loading_enabled() -> bool:
    return config.cloud_sql_loading_enabled()


def _insert_missing_sku(connection: Connection, row: dict) -> None:
    """Add a new SKU without changing an existing master record."""
    connection.execute(
        text(
            """
            INSERT INTO skus (
                sku, sku_range, product_name,
                size, brand, uom, pack_size, price
            ) VALUES (
                :sku, :sku_range, :product_name,
                :size, :brand, :uom, :pack_size, NULL
            )
            ON CONFLICT (sku)
            DO NOTHING
            """
        ),
        {
            "sku": row["sku"],
            "sku_range": row.get("sku_range"),
            "product_name": row.get("product_name"),
            "size": row.get("size"),
            "brand": row.get("brand"),
            "uom": row.get("uom"),
            "pack_size": row.get("pack_size"),
        },
    )


def _upsert_sellout(connection: Connection, records: list[dict]) -> None:
    if len(records) > _BULK_UPSERT_THRESHOLD:
        _upsert_sellout_in_batches(connection, records)
        return

    connection.execute(
        text(
            """
            INSERT INTO sellout (
                retailer_id, period_start, period_end, period_type,
                store_code, sku, quantity_units, revenue, source_file,
                loaded_at, data_source
            ) VALUES (
                :retailer_id, :period_start, :period_end, :period_type,
                :store_code, :sku, :quantity_units, :revenue, :source_file,
                :loaded_at, :data_source
            )
            ON CONFLICT (
                retailer_id, store_code, sku, period_start, period_type
            ) DO UPDATE SET
                period_end = EXCLUDED.period_end,
                quantity_units = EXCLUDED.quantity_units,
                revenue = EXCLUDED.revenue,
                source_file = EXCLUDED.source_file,
                loaded_at = EXCLUDED.loaded_at,
                data_source = EXCLUDED.data_source
            """
        ),
        records,
    )


def _upsert_sellout_in_batches(connection: Connection, records: list[dict]) -> None:
    """Use multi-row statements so large imports are not sent row by row."""
    columns_sql = ", ".join(SELLOUT_COLUMNS)
    for batch_start in range(0, len(records), _BULK_UPSERT_BATCH_SIZE):
        batch_end = batch_start + _BULK_UPSERT_BATCH_SIZE
        batch = records[batch_start:batch_end]
        parameters = {}
        value_rows = []
        for index, record in enumerate(batch):
            placeholders = []
            for column in SELLOUT_COLUMNS:
                parameter = f"{column}_{index}"
                placeholders.append(f":{parameter}")
                parameters[parameter] = record[column]
            value_rows.append(f"({', '.join(placeholders)})")

        connection.execute(
            text(
                f"""
                INSERT INTO sellout ({columns_sql})
                VALUES {', '.join(value_rows)}
                ON CONFLICT (
                    retailer_id, store_code, sku, period_start, period_type
                ) DO UPDATE SET
                    period_end = EXCLUDED.period_end,
                    quantity_units = EXCLUDED.quantity_units,
                    revenue = EXCLUDED.revenue,
                    source_file = EXCLUDED.source_file,
                    loaded_at = EXCLUDED.loaded_at,
                    data_source = EXCLUDED.data_source
                """
            ),
            parameters,
        )


def load_clean_rows(
    dataframe: pd.DataFrame,
    *,
    replace_source: bool = False,
    data_source: str = "aireos_upload",
    engine: Engine | None = None,
    loaded_at: datetime.datetime | None = None,
) -> dict:
    """Reuse catalog references, add missing SKUs, and upsert facts atomically."""
    if dataframe.empty:
        return {
            "rows_stored": 0,
            "rows_consolidated": 0,
            "storage_status": "completed",
        }

    if not data_source.strip():
        raise ValueError("data_source must not be blank")

    database = engine or sql.connect_with_connector()
    timestamp = loaded_at or datetime.datetime.now(datetime.timezone.utc)
    records, rows_consolidated = _prepare_records(dataframe)

    try:
        with database.begin() as connection:
            if replace_source:
                source_files = sorted(
                    {
                        row["source_file"]
                        for row in records
                        if row.get("source_file")
                    }
                )
                for source_file in source_files:
                    connection.execute(
                        text("DELETE FROM sellout WHERE source_file = :source_file"),
                        {"source_file": source_file},
                    )

            retailer_names = list(
                dict.fromkeys(str(row["retailer"]) for row in records)
            )
            retailer_ids = catalog_service.get_or_create_retailers(
                connection,
                retailer_names,
            )

            stores_by_key: dict[tuple[int, str], dict] = {}
            for row in records:
                retailer_id = retailer_ids[str(row["retailer"])]
                store_code = str(row["store_code"])
                store_key = (retailer_id, store_code)
                stores_by_key.setdefault(
                    store_key,
                    {
                        "retailer_id": retailer_id,
                        "store_code": store_code,
                        "store_name": row.get("store_name") or store_code,
                        "store_format": row.get("store_format"),
                    },
                )

            catalog_service.get_or_create_stores(
                connection,
                list(stores_by_key.values()),
            )

            skus_seen: set[str] = set()
            facts: list[dict] = []

            for row in records:
                retailer = str(row["retailer"])
                retailer_id = retailer_ids[retailer]
                sku = str(row["sku"])
                if sku not in skus_seen:
                    _insert_missing_sku(connection, row)
                    skus_seen.add(sku)

                facts.append(
                    {
                        "retailer_id": retailer_id,
                        "period_start": row["period_start"],
                        "period_end": row["period_end"],
                        "period_type": row["period_type"],
                        "store_code": str(row["store_code"]),
                        "sku": sku,
                        "quantity_units": row.get("quantity_units"),
                        "revenue": row.get("revenue"),
                        "source_file": row.get("source_file"),
                        "loaded_at": timestamp,
                        "data_source": data_source,
                    }
                )

            _upsert_sellout(connection, facts)
    except Exception as exc:
        raise SelloutLoadError(f"Cloud SQL sell-out load failed: {exc}") from exc

    return {
        "rows_stored": len(records),
        "rows_consolidated": rows_consolidated,
        "storage_status": "completed",
    }


# ============================================================
# DASHBOARD + INVENTORY READS
# ============================================================
#
# Reads use the autocommit engine (no BEGIN/ROLLBACK around a single SELECT),
# the same pattern as catalog_service/inventory_service -- see claude.md 2.3.


@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


# A new upload can land as either weekly or monthly rows for the same
# retailer+month (a monthly file supersedes weekly ones once it exists, but
# both can be present for older, already-reconciled months). Selecting raw
# `period_type='week'` rows forever missed a retailer+month that only ever
# got monthly rows (this is exactly what happened for August 2026); simply
# dropping the period_type filter would double-count months that have both.
# This view picks, per retailer+calendar-month, monthly rows when that
# retailer+month has any, else the real weekly rows -- never both. The
# preference is per retailer+month, not per SKU/store, per the ingestion
# team's rule. Public (no leading underscore): sellout_units.py reuses this
# exact text so inventory and the dashboard can never disagree about which
# rows are "the" sell-out for a given retailer+month.
EFFECTIVE_SELLOUT_CTE = """
    WITH monthly_coverage AS (
        SELECT DISTINCT retailer_id, date_trunc('month', period_start)::date AS month
        FROM sellout WHERE period_type = 'month'
    ),
    effective_sellout AS (
        SELECT retailer_id, store_code, sku, period_start, period_end,
               quantity_units, revenue, 'month' AS period_type
        FROM sellout WHERE period_type = 'month'

        UNION ALL

        SELECT s.retailer_id, s.store_code, s.sku, s.period_start, s.period_end,
               s.quantity_units, s.revenue, 'week' AS period_type
        FROM sellout s
        WHERE s.period_type = 'week'
          AND NOT EXISTS (
              SELECT 1 FROM monthly_coverage mc
              WHERE mc.retailer_id = s.retailer_id
                AND mc.month = date_trunc('month', s.period_start)::date
          )
    )
"""


# ============================================================
# Dashboard constants and small helpers (ported from bigquery.py -- that
# module now only talks to BigQuery, for forecast reads)
# ============================================================

SKU_RANKING_METRICS = ("volume", "value")
SKU_RANKING_COLUMNS = ["sku", "product_name", "volume", "value", "rank"]
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIOD_COMPARISON_TYPES = ("wow", "mom", "yoy")
DASHBOARD_MODES = ("offline", "online")
DASHBOARD_GRANULARITIES = ("week", "month")
DEFAULT_CUSTOMER = "fairprice"  # Fallback when no customer is supplied


def _retailer_for(customer: str, mode: str) -> str:
    # Retailer names use "{customer}_offline" or "{customer}_online", one
    # customer family split into the two dashboard channels.
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


# ============================================================
# SKU ranking, options, freshness
# ============================================================


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
    # Ranks SKUs by total units sold (volume) or total revenue (value), read
    # through the effective-sellout view (monthly rows preferred over weekly
    # for the same retailer+month) so a month-only period like August 2026
    # is never silently excluded from "all-time" or date-ranged rankings.
    if metric not in SKU_RANKING_METRICS:
        raise ValueError(f"metric must be one of {SKU_RANKING_METRICS}")
    if order not in ("asc", "desc"):
        raise ValueError("order must be 'asc' or 'desc'")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")

    sql_order = "ASC" if order == "asc" else "DESC"
    retailer_names = [_retailer_for(customer, mode)] if mode else _customer_retailers(customer)
    where_clauses = [
        "s.sku IS NOT NULL",
        "s.retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = ANY(CAST(:retailer_names AS text[])))",
    ]
    params: dict = {"retailer_names": retailer_names}
    if sku:
        where_clauses.append("s.sku = :sku")
        params["sku"] = sku
    if store:
        where_clauses.append("s.store_code = :store")
        params["store"] = store
    if start_date:
        where_clauses.append("s.period_start >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        where_clauses.append("s.period_start <= CAST(:end_date AS date)")
        params["end_date"] = end_date

    # metric/sql_order are interpolated only after validation against the
    # fixed SKU_RANKING_METRICS / asc|desc lists above -- never raw input.
    query = text(
        EFFECTIVE_SELLOUT_CTE
        + f"""
        SELECT
          s.sku,
          COALESCE(MAX(k.product_name), s.sku) AS product_name,
          COALESCE(SUM(s.quantity_units), 0) AS volume,
          COALESCE(SUM(s.revenue), 0) AS value
        FROM effective_sellout s
        LEFT JOIN skus k ON k.sku = s.sku
        WHERE {' AND '.join(where_clauses)}
        GROUP BY s.sku
        ORDER BY {metric} {sql_order}
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query, params).mappings().all()

    if not rows:
        return pd.DataFrame(columns=SKU_RANKING_COLUMNS)

    ranked = pd.DataFrame([dict(row) for row in rows])
    ranked["volume"] = ranked["volume"].astype(float)
    ranked["value"] = ranked["value"].astype(float).round(2)
    ranked = ranked.reset_index(drop=True)
    ranked["rank"] = ranked.index + 1
    return ranked[SKU_RANKING_COLUMNS]


def get_sku_options(customer: str = DEFAULT_CUSTOMER) -> list[dict]:
    # SKUs with real sales data (week or month rows -- existence only, no
    # monthly-preference logic needed for a distinct-values dropdown),
    # scoped to the customer's two channels. Ordered by product line
    # (sku_range) then size smallest-to-largest, same as before.
    retailer_names = _customer_retailers(customer)
    query = text(
        """
        SELECT DISTINCT s.sku, k.product_name, k.sku_range, k.size
        FROM sellout s
        LEFT JOIN skus k ON k.sku = s.sku
        WHERE s.sku IS NOT NULL
          AND s.period_type IN ('week', 'month')
          AND s.retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = ANY(CAST(:retailer_names AS text[])))
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query, {"retailer_names": retailer_names}).mappings().all()
    if not rows:
        return []

    size_order = {"S/M": 0, "L": 1, "XL": 2}
    options = []
    for row in rows:
        options.append(
            {
                "sku": row["sku"],
                "product_name": row["product_name"] or row["sku"],
                "_sort": (row["sku_range"] or "", size_order.get(row["size"], 3)),
            }
        )
    options.sort(key=lambda option: option["_sort"])
    return [{"sku": option["sku"], "product_name": option["product_name"]} for option in options]


def get_store_options(customer: str = DEFAULT_CUSTOMER) -> list[dict]:
    # Distinct stores (branches) with real sales data (week or month rows),
    # keyed on store_code; a code shared by both channels shows once, using
    # the first non-null name either channel has for it.
    retailer_names = _customer_retailers(customer)
    query = text(
        """
        SELECT DISTINCT s.store_code, st.store_name
        FROM sellout s
        LEFT JOIN stores st ON st.retailer_id = s.retailer_id AND st.store_code = s.store_code
        WHERE s.store_code IS NOT NULL
          AND s.period_type IN ('week', 'month')
          AND s.retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = ANY(CAST(:retailer_names AS text[])))
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query, {"retailer_names": retailer_names}).mappings().all()
    if not rows:
        return []

    by_code: dict[str, str | None] = {}
    for row in rows:
        by_code[row["store_code"]] = by_code.get(row["store_code"]) or row["store_name"]
    stores = [{"store_code": code, "store_name": name or code} for code, name in by_code.items()]
    return sorted(stores, key=lambda store: store["store_name"])


def get_customer_options() -> list[dict]:
    # Distinct top-level customers (retailer families, e.g. "fairprice") for
    # the page-header Customer selector, derived from whichever retailers
    # actually have sell-out rows (any period_type -- matches the original,
    # unfiltered). A newly ingested customer shows up automatically.
    query = text(
        """
        SELECT DISTINCT r.retailer_name
        FROM sellout s
        JOIN retailers r ON r.retailer_id = s.retailer_id
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query).all()
    families = sorted({_retailer_family(row[0]) for row in rows})
    return [{"value": family, "label": family.title()} for family in families]


def _format_last_updated(value) -> str | None:
    """A loaded_at value as a UTC ISO stamp (YYYY-MM-DDTHH:MM:SSZ).

    The frontend shows it in Singapore time (formatDateTime in lib/formatDate.js).
    """
    if value is None:
        return None
    ts = pd.to_datetime(value, utc=True)
    if pd.isna(ts):
        return None
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_data_freshness() -> dict:
    """
    Latest ingest time (MAX(loaded_at)) per retailer, across every customer.

    Not scoped to one customer -- feeds the dashboard's global dataVersion
    poll (useDataFreshness on the frontend), which must notice new data for
    ANY customer. Now reads Postgres directly, so this reflects an upload
    the moment it's written, not up to 15 minutes later via the old
    BigQuery replica.
    """
    query = text(
        """
        SELECT r.retailer_name, MAX(s.loaded_at) AS loaded_at
        FROM sellout s
        JOIN retailers r ON r.retailer_id = s.retailer_id
        GROUP BY r.retailer_name
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query).mappings().all()
    return {row["retailer_name"]: _format_last_updated(row["loaded_at"]) for row in rows}


# ============================================================
# Dashboard summary (revenue/units trend)
# ============================================================


def _week_label(period_start) -> str:
    # e.g. "Week 19 (07-05-2026)": ISO week number plus the week's start date.
    ts = pd.Timestamp(period_start)
    return f"Week {ts.isocalendar().week} ({ts.strftime('%d-%m-%Y')})"


def _dashboard_rows(df: pd.DataFrame, granularity: str) -> pd.DataFrame:
    # Rolls per-store-per-period rows (already carrying retailer name and
    # store format via SQL joins) up to the per-retailer-per-format-per-period
    # shape _dashboard_mode_summary expects.
    if df.empty:
        return df

    df = df.copy()
    starts = pd.to_datetime(df["period_start"].astype(object))
    df["period_key"] = (
        starts.dt.strftime("%Y-%m") if granularity == "month" else [_week_label(s) for s in starts]
    )

    rolled_up = df.groupby(["retailer", "format", "period_key"], as_index=False).agg(
        period_start=("period_start", "min"),
        revenue=("revenue", "sum"),
        units=("units", "sum"),
    )
    rolled_up["revenue"] = rolled_up["revenue"].round(2)
    rolled_up["period_label"] = (
        rolled_up["period_key"].apply(lambda m: datetime.datetime.strptime(m, "%Y-%m").strftime("%B %Y"))
        if granularity == "month"
        else rolled_up["period_key"]
    )
    return rolled_up.sort_values("period_start").reset_index(drop=True)


def _dashboard_mode_summary(df: pd.DataFrame, retailer: str) -> dict:
    # Splits the pre-aggregated per-period-by-format rows down to one
    # retailer, then reshapes into the three views the dashboard renders.
    if df.empty:
        return {"storeFormats": [], "periodTotal": [], "periodByFormat": []}

    mode_df = df[df["retailer"] == retailer]
    if mode_df.empty:
        return {"storeFormats": [], "periodTotal": [], "periodByFormat": []}

    store_formats = (
        mode_df.groupby("format", as_index=False)[["revenue", "units"]]
        .sum()
        .sort_values("revenue", ascending=False)
    )

    # Group by period_label alone (not period_start) -- different store
    # formats can have different MIN(period_start) within the same month.
    period_total = (
        mode_df.groupby("period_label", as_index=False)
        .agg(period_start=("period_start", "min"), revenue=("revenue", "sum"), units=("units", "sum"))
        .sort_values("period_start")
    )

    period_by_format = mode_df.sort_values("period_start")[
        ["period_label", "period_start", "format", "revenue", "units"]
    ]

    return {
        "storeFormats": store_formats[["format", "revenue", "units"]].to_dict(orient="records"),
        "periodTotal": period_total[["period_label", "period_start", "revenue", "units"]].to_dict(orient="records"),
        "periodByFormat": period_by_format.to_dict(orient="records"),
    }


def get_dashboard_summary(
    granularity: str = "week",
    sku: str | None = None,
    customer: str = DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    # Revenue/units per store format, split into offline/online, bucketed by
    # week or month. granularity='month' reads the monthly-preferred view
    # (effective_sellout), so a retailer+month that only has monthly rows
    # (e.g. August 2026) is included. granularity='week' reads genuine
    # weekly rows only -- a month with no real weekly breakdown correctly
    # comes back empty rather than fabricating weekly bars from a monthly
    # total; get_monthly_only_months tells the frontend when that happens.
    if granularity not in DASHBOARD_GRANULARITIES:
        raise ValueError(f"granularity must be one of {DASHBOARD_GRANULARITIES}")
    where_clauses, params = _dashboard_scope(customer, sku, store, start_date, end_date)

    if granularity == "month":
        source_cte = EFFECTIVE_SELLOUT_CTE
        from_clause = "FROM effective_sellout s"
    else:
        source_cte = ""
        where_clauses.append("s.period_type = 'week'")
        from_clause = "FROM sellout s"

    query = text(
        source_cte
        + f"""
        SELECT
          s.retailer_id, r.retailer_name AS retailer, s.store_code,
          COALESCE(st.store_format, 'UNKNOWN') AS format,
          s.period_start,
          SUM(s.revenue) AS revenue, SUM(s.quantity_units) AS units
        {from_clause}
        JOIN retailers r ON r.retailer_id = s.retailer_id
        LEFT JOIN stores st ON st.retailer_id = s.retailer_id AND st.store_code = s.store_code
        WHERE {' AND '.join(where_clauses)}
        GROUP BY s.retailer_id, r.retailer_name, s.store_code, st.store_format, s.period_start
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query, params).mappings().all()

    df = pd.DataFrame([dict(row) for row in rows]) if rows else pd.DataFrame()
    if not df.empty:
        df["revenue"] = df["revenue"].astype(float)
        df["units"] = df["units"].astype(float)
        df = _dashboard_rows(df, granularity)

    return {mode: _dashboard_mode_summary(df, _retailer_for(customer, mode)) for mode in DASHBOARD_MODES}


def get_monthly_only_months(
    sku: str | None = None,
    customer: str = DEFAULT_CUSTOMER,
    store: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Per channel, the months in the range loaded only as a monthly total
    (no weekly rows for that retailer+month, e.g. August 2026), as sorted
    YYYY-MM-01 strings. A weekly dashboard-summary is missing those months,
    so the dashboard reads both sides of a comparison by month instead, and
    names the months so users know which weekly data to upload."""
    where_clauses, params = _dashboard_scope(customer, sku, store, start_date, end_date)
    query = text(
        f"""
        SELECT DISTINCT r.retailer_name AS retailer, date_trunc('month', s.period_start)::date AS month
        FROM sellout s
        JOIN retailers r ON r.retailer_id = s.retailer_id
        WHERE {' AND '.join(where_clauses)}
          AND s.period_type = 'month'
          AND NOT EXISTS (
              SELECT 1 FROM sellout w
              WHERE w.retailer_id = s.retailer_id
                AND w.period_type = 'week'
                AND date_trunc('month', w.period_start) = date_trunc('month', s.period_start)
          )
        """
    )
    with _get_read_engine().connect() as conn:
        rows = conn.execute(query, params).mappings().all()
    months = {mode: set() for mode in DASHBOARD_MODES}
    for row in rows:
        for mode in DASHBOARD_MODES:
            if row["retailer"] == _retailer_for(customer, mode):
                months[mode].add(pd.Timestamp(row["month"]).strftime("%Y-%m-%d"))
    return {mode: sorted(found) for mode, found in months.items()}


def _dashboard_scope(
    customer: str, sku: str | None, store: str | None, start_date: str | None, end_date: str | None
) -> tuple[list[str], dict]:
    # WHERE clauses + bind params for one customer's sellout rows, shared by
    # get_dashboard_summary and get_monthly_only_months so both read the same
    # rows. A row counts when its period_start falls inside the range.
    _validate_date(start_date, "start_date")
    _validate_date(end_date, "end_date")
    where_clauses = [
        "s.retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = ANY(CAST(:retailer_names AS text[])))",
    ]
    params: dict = {"retailer_names": _customer_retailers(customer)}
    if sku:
        where_clauses.append("s.sku = :sku")
        params["sku"] = sku
    if store:
        where_clauses.append("s.store_code = :store")
        params["store"] = store
    if start_date:
        where_clauses.append("s.period_start >= CAST(:start_date AS date)")
        params["start_date"] = start_date
    if end_date:
        where_clauses.append("s.period_start <= CAST(:end_date AS date)")
        params["end_date"] = end_date
    return where_clauses, params


# ============================================================
# Latest period, default date range, period comparison
# ============================================================


def _latest_week_start(retailer: str | None) -> pd.Timestamp | None:
    # Most recent GENUINE week row's period_start -- for a week-over-week
    # comparison and the dashboard's week grid, which are inherently weekly
    # and must not silently substitute a monthly period.
    where_clauses = ["period_type = 'week'"]
    params: dict = {}
    if retailer:
        where_clauses.append("retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = :retailer_name)")
        params["retailer_name"] = retailer
    query = text(
        f"""
        SELECT period_start FROM sellout
        WHERE {' AND '.join(where_clauses)}
        ORDER BY period_start DESC
        LIMIT 1
        """
    )
    with _get_read_engine().connect() as conn:
        row = conn.execute(query, params).first()
    return pd.Timestamp(row[0]) if row else None


def _latest_preferred_period(retailer: str | None) -> dict | None:
    """
    The single most recent period from the effective-sellout view (monthly
    rows preferred over weekly for the same retailer+month), optionally
    scoped to one retailer/channel -- None when there's no data. Returns
    {"start": date, "end": date, "period_type": "week"|"month"}; period_end
    already correctly bounds coverage for both a week row and a month row,
    so callers never need to special-case granularity to know "how much of
    the current period is loaded".

    Deliberately NOT scoped to a customer's both channels when retailer is
    None -- same quirk the old _latest_week_start had: an unscoped call
    anchors on the single latest period across every retailer, not just one
    customer's. Preserved rather than "fixed" as a drive-by here.
    """
    where_clauses = []
    params: dict = {}
    if retailer:
        where_clauses.append("retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = :retailer_name)")
        params["retailer_name"] = retailer
    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    query = text(
        EFFECTIVE_SELLOUT_CTE
        + f"""
        SELECT period_start, period_end, period_type
        FROM effective_sellout
        {where_sql}
        ORDER BY period_end DESC
        LIMIT 1
        """
    )
    with _get_read_engine().connect() as conn:
        row = conn.execute(query, params).mappings().first()
    if row is None:
        return None
    return {"start": row["period_start"], "end": row["period_end"], "period_type": row["period_type"]}


def _earliest_period_start(retailer: str | None):
    # Start of the first sellout row (week or month), scoped like
    # _latest_preferred_period: one retailer/channel, or every retailer when
    # None. None when there's no data.
    where_sql = ""
    params: dict = {}
    if retailer:
        where_sql = "WHERE retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = :retailer_name)"
        params["retailer_name"] = retailer
    query = text(f"SELECT MIN(period_start) AS earliest_start FROM sellout {where_sql}")
    with _get_read_engine().connect() as conn:
        row = conn.execute(query, params).mappings().first()
    return row["earliest_start"] if row else None


def _month_bounds(anchor: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    start = anchor.replace(day=1)
    end = start + pd.offsets.MonthEnd(0)
    return start, end


def _year_bounds(anchor: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    start = pd.Timestamp(year=anchor.year, month=1, day=1)
    end = pd.Timestamp(year=anchor.year, month=12, day=31)
    return start, end


def get_default_date_range(
    customer: str = DEFAULT_CUSTOMER, mode: str | None = None, period: str = "month"
) -> dict:
    # Bounds anchored to the latest available PREFERRED period (monthly rows
    # win over weekly for the same retailer+month) -- not just the latest
    # week -- so the dashboard's default view reflects a monthly-only upload
    # (e.g. August 2026) instead of silently staying anchored on the last
    # genuine week. period='week' now returns the latest preferred period's
    # own bounds as-is (which may be a full month); period='month'/
    # '6months'/'12months' count calendar months back from that period's
    # month. `period_type` in the response tells the frontend whether the
    # latest period is a week or a month.
    month_spans = {"month": 1, "6months": 6, "12months": 12}
    if period not in ("week", *month_spans):
        raise ValueError(f"period must be one of {('week', *month_spans)}")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")

    retailer = _retailer_for(customer, mode) if mode else None
    latest = _latest_preferred_period(retailer)
    if latest is None:
        return {"start": None, "end": None, "period_type": None, "earliest_start": None, "latest_week_start": None}

    anchor = pd.Timestamp(latest["start"])
    if period == "week":
        start, end = anchor, pd.Timestamp(latest["end"])
    else:
        month_start, month_end = _month_bounds(anchor)
        span = month_spans[period]
        start = month_start - pd.DateOffset(months=span - 1)
        end = month_end
    earliest = _earliest_period_start(retailer)
    latest_week = _latest_week_start(retailer)
    return {
        "start": start.strftime("%Y-%m-%d"),
        "end": end.strftime("%Y-%m-%d"),
        "period_type": latest["period_type"],
        # The first loaded period, so the dashboard's month pickers can block
        # months before any data instead of a hard-coded year.
        "earliest_start": pd.Timestamp(earliest).strftime("%Y-%m-%d") if earliest is not None else None,
        # The latest GENUINE week's start, which can differ from `start` when
        # the newest data is a monthly total (e.g. Aug 1 2026, a Saturday,
        # while weekly rows start on Thursdays). The dashboard lines its
        # weeks up on this, so week labels and pairing match the real rows.
        "latest_week_start": latest_week.strftime("%Y-%m-%d") if latest_week is not None else None,
    }


def _resolve_preset_range(comparison_type: str, retailer: str | None):
    if comparison_type == "wow":
        # Weeks are a consistent 7-day cadence -- always anchored on a
        # genuine week row, never substituted with a monthly period.
        anchor = _latest_week_start(retailer)
        if anchor is None:
            return None
        current_start = anchor
        current_end = anchor + pd.Timedelta(days=6)
        previous_start = anchor - pd.Timedelta(days=7)
        previous_end = previous_start + pd.Timedelta(days=6)
        return current_start, current_end, previous_start, previous_end

    latest = _latest_preferred_period(retailer)
    if latest is None:
        return None
    anchor_start = pd.Timestamp(latest["start"])
    latest_available = pd.Timestamp(latest["end"])

    if comparison_type == "mom":
        # Current = month-to-date, truncated to what's actually loaded so
        # far (latest_available) -- a full month row makes that a no-op.
        # Previous = the same day-count from the start of the prior month,
        # for a fair like-for-like comparison.
        month_start, month_end = _month_bounds(anchor_start)
        current_start = month_start
        current_end = min(month_end, latest_available)
        days_covered = (current_end - current_start).days
        previous_start = month_start - pd.DateOffset(months=1)
        previous_end = previous_start + pd.Timedelta(days=days_covered)
    else:  # yoy
        year_start, year_end = _year_bounds(anchor_start)
        current_start = year_start
        current_end = min(year_end, latest_available)
        days_covered = (current_end - current_start).days
        previous_start = year_start - pd.DateOffset(years=1)
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
    # Compares total revenue/units between two periods, reading through the
    # effective-sellout view so a range spanning a month-only period (e.g.
    # August 2026) is never silently under-counted -- EXCEPT comparison_type
    # 'wow' (week-over-week), which reads genuine weekly rows only. A monthly
    # row's single period_start can land inside a 7-day window and would
    # otherwise silently inflate a "this week" figure into "this whole
    # month" -- the same "don't fabricate weekly from monthly" problem the
    # frontend guards against, just on the data side instead of the label.
    if comparison_type is not None and comparison_type not in PERIOD_COMPARISON_TYPES:
        raise ValueError(f"comparison_type must be one of {PERIOD_COMPARISON_TYPES}")
    if mode is not None and mode not in DASHBOARD_MODES:
        raise ValueError(f"mode must be one of {DASHBOARD_MODES}")

    retailer = _retailer_for(customer, mode) if mode else None

    if current_start and current_end:
        _validate_date(current_start, "current_start")
        _validate_date(current_end, "current_end")
        cur_start, cur_end = pd.Timestamp(current_start), pd.Timestamp(current_end)
        if previous_start and previous_end:
            _validate_date(previous_start, "previous_start")
            _validate_date(previous_end, "previous_end")
            prev_start, prev_end = pd.Timestamp(previous_start), pd.Timestamp(previous_end)
        else:
            prev_start = cur_start - pd.DateOffset(months=1)
            prev_end = cur_end - pd.DateOffset(months=1)
    elif comparison_type:
        resolved = _resolve_preset_range(comparison_type, retailer)
        if resolved is None:
            return _empty_period_comparison()
        cur_start, cur_end, prev_start, prev_end = resolved
    else:
        # No preset, no explicit dates: default to the latest preferred
        # period vs. one month before it -- same anchor get_default_date_range
        # uses, so "the default view" is consistent everywhere.
        latest = _latest_preferred_period(retailer)
        if latest is None:
            return _empty_period_comparison()
        cur_start, cur_end = pd.Timestamp(latest["start"]), pd.Timestamp(latest["end"])
        prev_start = cur_start - pd.DateOffset(months=1)
        prev_end = cur_end - pd.DateOffset(months=1)

    overall_start = min(cur_start, prev_start)
    overall_end = max(cur_end, prev_end)
    # retailer is deliberately omitted from the filter when mode is None --
    # preserves the existing (if surprising) "no mode = no retailer/customer
    # filter at all" behavior, locked in by
    # test_period_comparison_without_mode_has_no_retailer_filter. Not fixed
    # as a drive-by in this migration.
    where_clauses = ["period_start BETWEEN CAST(:overall_start AS date) AND CAST(:overall_end AS date)"]
    params: dict = {
        "overall_start": overall_start.strftime("%Y-%m-%d"),
        "overall_end": overall_end.strftime("%Y-%m-%d"),
        "cur_start": cur_start.strftime("%Y-%m-%d"),
        "cur_end": cur_end.strftime("%Y-%m-%d"),
        "prev_start": prev_start.strftime("%Y-%m-%d"),
        "prev_end": prev_end.strftime("%Y-%m-%d"),
    }
    if retailer:
        where_clauses.append("retailer_id IN (SELECT retailer_id FROM retailers WHERE retailer_name = :retailer_name)")
        params["retailer_name"] = retailer
    if sku:
        where_clauses.append("sku = :sku")
        params["sku"] = sku
    if store:
        where_clauses.append("store_code = :store")
        params["store"] = store

    if comparison_type == "wow":
        source_cte = ""
        from_clause = "FROM sellout"
        where_clauses.append("period_type = 'week'")
    else:
        source_cte = EFFECTIVE_SELLOUT_CTE
        from_clause = "FROM effective_sellout"

    query = text(
        source_cte
        + f"""
        SELECT
          SUM(CASE WHEN period_start BETWEEN CAST(:cur_start AS date) AND CAST(:cur_end AS date)
                   THEN revenue ELSE 0 END) AS current_revenue,
          SUM(CASE WHEN period_start BETWEEN CAST(:cur_start AS date) AND CAST(:cur_end AS date)
                   THEN quantity_units ELSE 0 END) AS current_units,
          SUM(CASE WHEN period_start BETWEEN CAST(:prev_start AS date) AND CAST(:prev_end AS date)
                   THEN revenue ELSE 0 END) AS previous_revenue,
          SUM(CASE WHEN period_start BETWEEN CAST(:prev_start AS date) AND CAST(:prev_end AS date)
                   THEN quantity_units ELSE 0 END) AS previous_units,
          COUNT(*) FILTER (WHERE period_start BETWEEN CAST(:prev_start AS date) AND CAST(:prev_end AS date))
                   AS previous_row_count
        {from_clause}
        WHERE {' AND '.join(where_clauses)}
        """
    )
    with _get_read_engine().connect() as conn:
        row = conn.execute(query, params).mappings().first()

    def _num(value) -> float:
        return round(float(value), 2) if value is not None else 0.0

    return {
        "current": {
            "start": cur_start.strftime("%Y-%m-%d"),
            "end": cur_end.strftime("%Y-%m-%d"),
            "revenue": _num(row["current_revenue"]) if row else 0.0,
            "units": _num(row["current_units"]) if row else 0.0,
        },
        "previous": {
            "start": prev_start.strftime("%Y-%m-%d"),
            "end": prev_end.strftime("%Y-%m-%d"),
            "revenue": _num(row["previous_revenue"]) if row else 0.0,
            "units": _num(row["previous_units"]) if row else 0.0,
            "available": ((row["previous_row_count"] or 0) > 0) if row else False,
        },
    }
