from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DatabaseError

from app.services import catalog_service, forecast_units, inventory_calc, notification_service, sellout_units, sql
from app.services.sell_in_upload import (
    canonical_customer_name,
    customer_match_key,
    product_for_description,
    quantity_problem,
    read_sell_in_lines,
)
from app.services.scenario import budgets as budget_service
from app.services.scenario import block_effects
from app.services.scenario import building_blocks as scenario_blocks
from app.services.settings import doh as doh_settings


# ============================================================
# Custom Exceptions
# ============================================================


class CustomerNotFoundError(Exception):
    pass


class SkuNotFoundError(Exception):
    pass


class InventoryNotFoundError(Exception):
    pass


class InventoryConflictError(Exception):
    pass


# ============================================================
# Constants
# ============================================================

# Only these are read from inventory_metrics. Sell-out itself is not: it comes
# from the same weekly sales data as the dashboard (see _fetch_actuals), so the
# sell_out_base rows the workbook load left in the table are ignored.
# sell_out_building_blocks is the one exception -- stock used for something
# other than sell-out (so the dashboard's data never sees it), entered manually
# and subtracted from ending stock the same way sell-out is.
INVENTORY_METRICS = (
    "opening_inventory",
    "sell_in",
    "sell_out_building_blocks",
)

# Rows written from the app carry this data_source so they never collide with
# (or overwrite) the rows loaded from the inventory workbook.
MANUAL_DATA_SOURCE = "manual_entry"

# value_type per metric for a manual write of actuals.
_VALUE_TYPES = {
    "opening_inventory": "actual",
    "sell_in": "actual",
    "sell_out_building_blocks": "actual",
}


# ============================================================
# ENGINE
#
# sql.connect_with_connector*() hand back process-wide singletons, so these
# wrappers reuse the same pools as the other services. Reads use the autocommit
# engine (no BEGIN/ROLLBACK around a single SELECT); every write is one
# transaction on the normal engine.
# ============================================================


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    return sql.connect_with_connector()


@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


def _read_connection() -> Connection:
    return _get_read_engine().connect()


# ============================================================
# SMALL HELPERS
# ============================================================


def _utc_today() -> date:
    # Not date.today(), which follows whatever timezone the server runs in.
    return datetime.now(timezone.utc).date()


def _current_month() -> date:
    """First of the current month: where the sell-in plan's "months ahead" count from."""
    return _utc_today().replace(day=1)


def _months_inclusive(first: date, last: date) -> int:
    """How many months from `first` to `last`, both counted (0 when last is earlier)."""
    return max((last.year - first.year) * 12 + last.month - first.month + 1, 0)


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def _in_range(month: date, start_month: date | None, end_month: date | None) -> bool:
    if start_month is not None and month < inventory_calc.month_start(start_month):
        return False
    if end_month is not None and month > inventory_calc.month_start(end_month):
        return False
    return True


# ============================================================
# CUSTOMERS
# ============================================================


def _fetch_customers(conn: Connection) -> dict[int, str]:
    rows = conn.execute(
        text(
            """
            SELECT
                customer_id,
                customer_name

            FROM customers

            ORDER BY
                customer_name ASC
            """
        )
    ).mappings().all()

    return {row["customer_id"]: row["customer_name"] for row in rows}


def list_customers() -> list[dict]:
    with _read_connection() as conn:
        customers = _fetch_customers(conn)

    return [
        {"customer_id": customer_id, "customer_name": name}
        for customer_id, name in customers.items()
    ]


def _require_customers(customers: dict[int, str], customer_ids: list[int]) -> None:
    missing = [customer_id for customer_id in customer_ids if customer_id not in customers]
    if missing:
        raise CustomerNotFoundError(
            f"Customer {', '.join(str(i) for i in missing)} does not exist."
        )


def list_skus() -> list[dict]:
    """Catalog SKUs for the pickers, so a SKU with no inventory yet can still be chosen."""

    details = _sku_details()
    rows = [_sku_columns(sku, details) for sku in details]
    return sorted(rows, key=lambda r: (r["sku_range"] or "", r["product_name"]))


# ============================================================
# EFFECTIVE METRIC VALUES
#
# inventory_metrics keeps every version of a value (the workbook load
# and any manual entries). Reads take one value per customer, SKU,
# month and metric: a manual entry beats the workbook, then the
# newest as_of_date, then the newest load. A sell_in row marked
# manual_plan is "temporary sell-in" (see the sell-in plan below), not an
# actual, so it is left out of every actuals read.
# ============================================================

_EFFECTIVE_METRICS_SQL = """
    SELECT DISTINCT ON (
        customer_id,
        sku,
        period_start,
        metric_name
    )
        customer_id,
        sku,
        period_start,
        metric_name,
        metric_value

    FROM inventory_metrics

    WHERE
        metric_name = ANY(CAST(:metric_names AS text[]))
        AND NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')
        AND (
            CAST(:customer_ids AS integer[]) IS NULL
            OR customer_id = ANY(CAST(:customer_ids AS integer[]))
        )

    ORDER BY
        customer_id,
        sku,
        period_start,
        metric_name,
        (data_source = :manual_source) DESC,
        as_of_date DESC,
        loaded_at DESC
"""


def _fetch_metrics(
    conn: Connection,
    customer_ids: list[int] | None = None,
) -> dict[tuple[int, str], dict[date, dict[str, float]]]:
    """Effective values grouped as {(customer_id, sku): {month: {metric: value}}}."""

    rows = conn.execute(
        text(_EFFECTIVE_METRICS_SQL),
        {
            "metric_names": list(INVENTORY_METRICS),
            "customer_ids": customer_ids,
            "manual_source": MANUAL_DATA_SOURCE,
        },
    ).mappings().all()

    grouped: dict[tuple[int, str], dict[date, dict[str, float]]] = {}
    for row in rows:
        months = grouped.setdefault((row["customer_id"], row["sku"]), {})
        months.setdefault(row["period_start"], {})[row["metric_name"]] = row["metric_value"]
    return grouped


_SHIPPED_SO_FAR_SQL = """
    SELECT DISTINCT ON (
        sku,
        period_start
    )
        sku,
        period_start,
        metric_value

    FROM inventory_metrics

    WHERE
        customer_id = :customer_id
        AND metric_name = 'sell_in'
        AND value_type = 'manual_plan'

    ORDER BY
        sku,
        period_start,
        as_of_date DESC,
        loaded_at DESC
"""


def _fetch_shipped(conn: Connection, customer_id: int) -> dict[str, dict[date, float]]:
    """Shipped-so-far values as {sku: {month: units}}, newest entry per SKU and month."""

    rows = conn.execute(text(_SHIPPED_SO_FAR_SQL), {"customer_id": customer_id}).mappings().all()

    shipped: dict[str, dict[date, float]] = {}
    for row in rows:
        shipped.setdefault(row["sku"], {})[row["period_start"]] = row["metric_value"]
    return shipped


_CUSTOMER_RETAILERS_SQL = """
    SELECT
        customer_id,
        retailer_id

    FROM customer_retailers

    WHERE
        customer_id = ANY(CAST(:customer_ids AS integer[]))
"""


_CUSTOMER_FAMILIES_SQL = """
    SELECT
        cr.customer_id,
        regexp_replace(r.retailer_name, '_(offline|online)$', '') AS family

    FROM retailers r
    JOIN customer_retailers cr ON cr.retailer_id = r.retailer_id
"""


def _fetch_customer_families(conn: Connection) -> list[tuple[str, int]]:
    """(retailer family, customer_id) for every linked retailer: the name a
    customer's sales are filed under (sheng_siong for sheng_siong_offline /
    _online). Linked by id, so it holds whatever the customer is renamed to."""

    rows = conn.execute(text(_CUSTOMER_FAMILIES_SQL)).mappings().all()
    return [(row["family"], row["customer_id"]) for row in rows]


def _customers_by_match_key(names: list[tuple[str, int]]) -> dict[str, set[int]]:
    """The customers each name stands for, keyed by customer_match_key. A key
    with more than one customer is ambiguous and must not be guessed at."""

    customers: dict[str, set[int]] = {}
    for name, customer_id in names:
        key = customer_match_key(name)
        if key:
            customers.setdefault(key, set()).add(customer_id)
    return customers


def _fetch_customer_retailers(conn: Connection, customer_ids: list[int]) -> dict[int, list[int]]:
    """The retailers whose sales make up each customer, as {customer_id: [retailer_id]}."""

    rows = conn.execute(text(_CUSTOMER_RETAILERS_SQL), {"customer_ids": customer_ids}).mappings().all()

    retailers: dict[int, list[int]] = {}
    for row in rows:
        retailers.setdefault(row["customer_id"], []).append(row["retailer_id"])
    return retailers


def _fetch_actuals(
    conn: Connection,
    customer_ids: list[int] | None = None,
) -> dict[tuple[int, str], dict[date, dict[str, float]]]:
    """
    Actuals per {(customer_id, sku): {month: {metric: value}}}: sell-in, the
    first month's opening and any building blocks from inventory_metrics,
    sell-out from the sales dashboard's weekly data (each week counted in the
    month it starts, a SKU with no sales that month is 0). A SKU's actuals run
    to the customer's last month of sell-in: a month the customer's other SKUs
    have sell-in for and this one doesn't is 0 shipped, not missing. A month is
    only kept once the sales data covers all of it, so a half-loaded month
    never counts as actual.
    """

    metrics = _fetch_metrics(conn, customer_ids)
    retailers = _fetch_customer_retailers(conn, sorted({customer for customer, _ in metrics}))
    sales = {
        customer: sellout_units.get_monthly_sellout(retailer_ids, conn=conn)
        for customer, retailer_ids in retailers.items()
    }

    last_sell_in = _last_sell_in_month_by_customer(metrics)
    actuals: dict[tuple[int, str], dict[date, dict[str, float]]] = {}
    for (customer_id, sku), months in metrics.items():
        units, data_through = sales.get(customer_id, ({}, None))
        sku_units = units.get(sku, {})
        # A month inside the SKU's history with sales but no inventory row
        # (nothing shipped that month) still sold stock. So does a month after
        # the SKU's last row up to the customer's last month of sell-in: the
        # tracker had sell-in for the customer's other SKUs that month and none
        # for this one, so nothing was shipped (0), not "not entered yet". A
        # month no SKU of the customer has sell-in for stays out.
        first, last = min(months), max(months)
        sold_between = {month: {} for month in sku_units if first < month < last}
        shipped_none_since = {
            month: {} for month in _months_after(last, last_sell_in.get(customer_id, last))
        }
        by_month = {}
        for month, values in {**sold_between, **shipped_none_since, **months}.items():
            if data_through is None or data_through < _month_end(month):
                continue
            by_month[month] = {**values, "sell_out_base": sku_units.get(month, 0.0)}
        if by_month:
            actuals[(customer_id, sku)] = by_month
    return actuals


def _last_sell_in_month_by_customer(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
) -> dict[int, date]:
    """Each customer's most recent month with a sell-in value for any SKU."""

    latest: dict[int, date] = {}
    for (customer_id, _), months in metrics.items():
        for month, values in months.items():
            if "sell_in" in values and month > latest.get(customer_id, date.min):
                latest[customer_id] = month
    return latest


def _months_after(start: date, through: date) -> list[date]:
    """The month starts after `start` up to and including `through`."""

    months = []
    month = inventory_calc.add_months(start, 1)
    while month <= through:
        months.append(month)
        month = inventory_calc.add_months(month, 1)
    return months


def _latest_month_by_customer(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
) -> dict[int, date]:
    """Each customer's most recent month of data across all its SKUs."""

    latest: dict[int, date] = {}
    for (customer_id, _), months in metrics.items():
        newest = max(months)
        if customer_id not in latest or newest > latest[customer_id]:
            latest[customer_id] = newest
    return latest


def _sku_details() -> dict[str, dict]:
    return {row["sku"]: row for row in catalog_service.get_skus()}


def _sku_columns(sku: str, details: dict[str, dict]) -> dict:
    info = details.get(sku) or {}
    return {
        "sku": sku,
        "product_name": info.get("product_name") or sku,
        "sku_range": info.get("sku_range"),
        "size": info.get("size"),
    }


def _known_skus(
    forecast: dict[str, dict[date, float]],
    details: dict[str, dict],
) -> dict[str, dict[date, float]]:
    """Predicted units keyed by SKU code; a forecast row for a SKU our own catalog
    doesn't know is skipped."""

    return {sku: months for sku, months in forecast.items() if sku in details}


def _forecast_by_sku(customer_id: int, details: dict[str, dict]) -> dict[str, dict[date, float]]:
    """Predicted units keyed by SKU code; a forecast row for a SKU our own catalog
    doesn't know is skipped."""

    return {
        sku: months
        for sku, months in forecast_units.get_forecast_units(customer_id).items()
        if sku in details
    }


def _plan_forecast(
    lines: dict[str, dict[str, dict[date, float]]],
    details: dict[str, dict],
) -> tuple[dict[str, dict[date, float]], dict[str, dict[date, str]], dict[str, dict[date, float]]]:
    """
    The forecast the sell-in plan runs on, per SKU and month: the current
    forecast where it has the month, otherwise the Initial Yearly Forecast.
    The current run starts after the newest sales month, so without the
    initial a customer whose sell-in actuals stop earlier would have no
    forecast for the months straight after them, and no plan at all. Also
    returns which line each month came from ("current" / "initial") and the
    initial on its own (the outlook draws it as a line).
    """

    current = _known_skus(lines.get("current", {}), details)
    initial = _known_skus(lines.get("initial", {}), details)
    merged: dict[str, dict[date, float]] = {}
    source: dict[str, dict[date, str]] = {}
    for sku in current.keys() | initial.keys():
        merged[sku] = {**initial.get(sku, {}), **current.get(sku, {})}
        source[sku] = {
            month: "current" if month in current.get(sku, {}) else "initial" for month in merged[sku]
        }
    return merged, source, initial


# ============================================================
# OVERVIEW (all customers)
# ============================================================


def _stock_row(customer_id: int, customer_name: str, sku_cols: dict, row: dict) -> dict:
    return {
        "customer_id": customer_id,
        "customer_name": customer_name,
        **sku_cols,
        "month": _iso(row["month"]),
        "opening_stock": row["opening_stock"],
        "sell_in": row["sell_in"],
        # The dashboard's own sell-out figure exactly (sell_out_base), not
        # row["sell_out"] (base + building_blocks) -- so this always matches the
        # Sales Dashboard for the same customer/SKU/month. building_blocks is the
        # separate piece that also leaves inventory but was never sell-out; both
        # are subtracted to reach ending_stock, so opening + sell_in - sell_out -
        # building_blocks = ending_stock reconciles visibly, column by column.
        "sell_out": row["sell_out_base"],
        "building_blocks": row["sell_out_building_blocks"],
        "ending_stock": row["ending_stock"],
        # False for a month filled in with zero movement (no rows of its own),
        # which can be created but not edited.
        "has_data": row["has_data"],
    }


def get_overview(
    customer_ids: list[int] | None = None,
    skus: list[str] | None = None,
    start_month: date | None = None,
    end_month: date | None = None,
    at_risk_only: bool = False,
) -> dict:
    """
    Ending stock for every customer: monthly totals per customer for the
    bar graph, and one row per customer, SKU and month for the table.
    `at_risk_only` keeps only the SKUs that are on the at-risk list now.
    Each SKU's stock is chained from its first month, then the SKU and
    date filters are applied to what is shown, so a filter never changes
    a figure.
    """

    with _read_connection() as conn:
        customers = _fetch_customers(conn)
        metrics = _fetch_actuals(conn, customer_ids)

    at_risk = (
        {(item["customer_id"], item["sku"]) for item in get_at_risk(customer_ids)["items"]}
        if at_risk_only
        else None
    )

    details = _sku_details()
    latest = _latest_month_by_customer(metrics)
    table = []
    for (customer_id, sku), months in metrics.items():
        if customer_id not in customers or (skus and sku not in skus):
            continue
        if at_risk is not None and (customer_id, sku) not in at_risk:
            continue
        sku_cols = _sku_columns(sku, details)
        for row in inventory_calc.build_monthly_series(months, through=latest[customer_id]):
            if _in_range(row["month"], start_month, end_month):
                table.append(_stock_row(customer_id, customers[customer_id], sku_cols, row))

    table.sort(key=lambda r: (r["customer_name"], r["month"], r["sku"]))

    totals: dict[tuple[int, str], float] = {}
    for row in table:
        key = (row["customer_id"], row["month"])
        totals[key] = totals.get(key, 0.0) + row["ending_stock"]

    monthly = [
        {
            "customer_id": customer_id,
            "customer_name": customers[customer_id],
            "month": month,
            "ending_stock": round(total, 2),
        }
        for (customer_id, month), total in sorted(
            totals.items(), key=lambda item: (item[0][1], customers[item[0][0]])
        )
    ]

    return {
        "customers": [
            {"customer_id": customer_id, "customer_name": name}
            for customer_id, name in customers.items()
        ],
        "monthly": monthly,
        "skus": table,
    }


# ============================================================
# DOH THRESHOLDS
#
# Min, target and max come from the DOH settings (settings/doh.py), which
# keep every version. A closed month is judged against the version in effect
# on its last day, so changing a setting never rewrites history. A customer's
# latest month of actuals is its stock position now, so it is judged against
# the current version, the same one the at-risk list, the threshold card and
# the sell-in plan use; a change shows up there straight away.
# ============================================================


def _band(thresholds: dict) -> dict:
    # NUMERIC columns come back as Decimal; DOH is calculated as float.
    return {
        "target_doh": float(thresholds["target_doh"]),
        "min_doh": float(thresholds["min_doh"]),
        "max_doh": float(thresholds["max_doh"]),
    }


def _band_for_month(versions: list[dict], month: date, latest: date) -> dict:
    if month >= latest:
        return _band(doh_settings.current_thresholds(versions))
    return _band(doh_settings.thresholds_on(versions, _month_end(month)))


def _threshold_view(customer_id: int, customer_name: str, versions: list[dict]) -> dict:
    current = doh_settings.current_thresholds(versions)
    return {
        "customer_id": customer_id,
        "customer_name": customer_name,
        **_band(current),
        "is_global_default": current["is_global_default"],
        "last_updated": current["updated_at"],
        "updated_by": current["updated_by"],
    }


# ============================================================
# CUSTOMER VIEW (one customer, with DOH)
# ============================================================


def _customer_table(
    customer_id: int,
    customer_name: str,
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    versions: list[dict],
    details: dict[str, dict],
    forecast: dict[str, dict[date, float]],
    skus: list[str] | None = None,
    start_month: date | None = None,
    end_month: date | None = None,
) -> list[dict]:
    """
    One customer's SKU-by-month rows with stock, DOH, target, gap and status,
    oldest month first. Each SKU's stock is chained from its first month, then
    the SKU and month filters choose what is returned.
    """

    latest = _latest_month_by_customer(metrics)
    table = []
    for (_, sku), months in metrics.items():
        if skus and sku not in skus:
            continue
        sku_cols = _sku_columns(sku, details)
        series = inventory_calc.add_doh(
            inventory_calc.build_monthly_series(months, through=latest[customer_id]),
            forecast.get(sku, {}),
        )
        for row in series:
            if not _in_range(row["month"], start_month, end_month):
                continue
            table.append(
                {
                    **_stock_row(customer_id, customer_name, sku_cols, row),
                    "doh": row["doh"],
                    "daily_sell_out": row["daily_sell_out"],
                    **_target_columns(
                        _band_for_month(versions, row["month"], latest[customer_id]), row["doh"]
                    ),
                }
            )

    table.sort(key=lambda r: (r["month"], r["sku"]))
    return table


def get_customer_view(
    customer_id: int,
    skus: list[str] | None = None,
    start_month: date | None = None,
    end_month: date | None = None,
) -> dict:
    """
    One customer's stock with DOH: a trend row per month (combined DOH
    against that month's target and band) and one table row per SKU and
    month with the gap to target. Each closed month is measured against the
    DOH settings in effect at its end, the latest month against the current
    ones (see DOH THRESHOLDS).
    """

    # The BigQuery forecast is the slowest read, so it runs in the background
    # while Postgres answers the rest: the request waits for the slower of the
    # two instead of both. Started only once the customer is known to exist.
    with ThreadPoolExecutor(max_workers=1) as pool:
        with _read_connection() as conn:
            customers = _fetch_customers(conn)
            _require_customers(customers, [customer_id])
            forecast_job = pool.submit(forecast_units.get_forecast_units, customer_id)
            metrics = _fetch_actuals(conn, [customer_id])
            versions = doh_settings.fetch_versions(conn, [customer_id]).get(customer_id, [])

        details = _sku_details()
        forecast = _known_skus(forecast_job.result(), details)

    table = _customer_table(
        customer_id,
        customers[customer_id],
        metrics,
        versions,
        details,
        forecast,
        skus=skus,
        start_month=start_month,
        end_month=end_month,
    )

    by_month: dict[str, list[dict]] = {}
    for row in table:
        by_month.setdefault(row["month"], []).append(row)

    latest = _latest_month_by_customer(metrics).get(customer_id)
    trend = []
    for month, rows in by_month.items():
        doh = inventory_calc.combined_doh(rows)
        trend.append(
            {
                "month": month,
                "ending_stock": round(sum(r["ending_stock"] for r in rows), 2),
                "sell_in": round(sum(r["sell_in"] for r in rows), 2),
                "doh": doh,
                **_target_columns(_band_for_month(versions, date.fromisoformat(month), latest), doh),
            }
        )

    return {
        "customer": {"customer_id": customer_id, "customer_name": customers[customer_id]},
        "threshold": _threshold_view(customer_id, customers[customer_id], versions),
        "trend": trend,
        "skus": table,
    }


def _target_columns(band: dict, doh: float | None) -> dict:
    """Target, band, gap and status for a DOH against one month's band (see _band_for_month)."""

    return {
        **band,
        "doh_vs_target": None if doh is None else round(doh - band["target_doh"], 1),
        "doh_status": inventory_calc.threshold_status(doh, band["min_doh"], band["max_doh"]),
    }


# ============================================================
# AT RISK (all customers)
#
# A SKU is at risk when its days of holding, in the customer's latest month
# of actuals, is outside the customer's current min-max band: below min (low stock)
# or above max (overstock). The list is recalculated on every request, so a
# SKU drops off it as soon as a new month brings its DOH back inside the band.
# ============================================================

AT_RISK_STATUSES = (inventory_calc.DOH_STATUS_BELOW_MIN, inventory_calc.DOH_STATUS_ABOVE_MAX)


def _at_risk_item(row: dict) -> dict:
    """An at-risk SKU row with how far its DOH sits outside the band, in days."""

    outside = (
        row["min_doh"] - row["doh"]
        if row["doh_status"] == inventory_calc.DOH_STATUS_BELOW_MIN
        else row["doh"] - row["max_doh"]
    )
    return {
        "customer_id": row["customer_id"],
        "customer_name": row["customer_name"],
        "sku": row["sku"],
        "product_name": row["product_name"],
        "sku_range": row["sku_range"],
        "size": row["size"],
        "month": row["month"],
        "ending_stock": row["ending_stock"],
        "doh": row["doh"],
        "target_doh": row["target_doh"],
        "min_doh": row["min_doh"],
        "max_doh": row["max_doh"],
        "doh_status": row["doh_status"],
        "days_outside_band": round(outside, 1),
    }


def get_at_risk(
    customer_ids: list[int] | None = None,
    risk: str | None = None,
) -> dict:
    """
    Every at-risk SKU across the chosen customers (all by default) in one list,
    most severe first (furthest outside its band). `risk` narrows the list to
    below_min or above_max; the counts always cover both so the page can show
    the split. `as_of` is the latest month of actuals the list is judged on.
    """

    if risk is not None and risk not in AT_RISK_STATUSES:
        raise ValueError(f"risk must be one of {AT_RISK_STATUSES}")

    # One BigQuery read for every chosen customer, in the background while
    # Postgres answers the rest (see get_customer_view).
    with ThreadPoolExecutor(max_workers=1) as pool:
        with _read_connection() as conn:
            customers = _fetch_customers(conn)
            chosen = customer_ids or list(customers)
            _require_customers(customers, chosen)
            forecast_job = pool.submit(forecast_units.get_forecast_units_by_customer, chosen)
            metrics = _fetch_actuals(conn, chosen)
            versions = doh_settings.fetch_versions(conn, chosen)

        details = _sku_details()
        forecasts = forecast_job.result()

    latest = _latest_month_by_customer(metrics)

    items = []
    for customer_id in chosen:
        if customer_id not in latest:
            continue
        table = _customer_table(
            customer_id,
            customers[customer_id],
            {key: months for key, months in metrics.items() if key[0] == customer_id},
            versions.get(customer_id, []),
            details,
            _known_skus(forecasts.get(customer_id, {}), details),
            start_month=latest[customer_id],
            end_month=latest[customer_id],
        )
        items.extend(_at_risk_item(row) for row in table if row["doh_status"] in AT_RISK_STATUSES)

    counts = {status: sum(1 for item in items if item["doh_status"] == status) for status in AT_RISK_STATUSES}
    if risk is not None:
        items = [item for item in items if item["doh_status"] == risk]
    items.sort(key=lambda item: (-item["days_outside_band"], item["customer_name"], item["product_name"]))

    return {
        "as_of": _iso(max(latest.values())) if latest else None,
        "counts": counts,
        "items": items,
    }


# ============================================================
# SELL-IN PLAN (one customer)
#
# Projects each SKU forward from its last actual ending stock using the
# forecast sell-out, and recommends the sell-in that leaves the customer at
# the target DOH at the end of each month (rule in
# inventory_calc.build_sell_in_plan).
# ============================================================


def _sku_plans(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    forecast: dict[str, dict[date, float]],
    shipped: dict[str, dict[date, float]],
    threshold: dict,
    until: date,
    details: dict[str, dict],
    source: dict[str, dict[date, str]] | None = None,
) -> tuple[dict[str, tuple[date, float]], list[dict], list[dict]]:
    """
    Each SKU's last actual month and ending stock, its planned rows (raw dates),
    and the SKUs with no forecast for their start month. Every SKU plans from
    the month after its own last actual month up to `until`, so they all end
    together. A plan is what to send from now on, so every month aims at the
    current target, even when a SKU's last actual month is some way back.
    """

    def target_for(month: date) -> float:
        return threshold["target_doh"]

    last_actual = {}
    for (_, sku), sku_months in metrics.items():
        last = inventory_calc.build_monthly_series(sku_months)[-1]
        last_actual[sku] = (last["month"], last["ending_stock"])

    rows = []
    without_forecast = []
    for sku, (last_month, ending_stock) in last_actual.items():
        sku_cols = _sku_columns(sku, details)
        first = inventory_calc.add_months(last_month, 1)
        # Actuals already reach past the plan's end: nothing to plan, which
        # is not the same as having no forecast.
        if first > until:
            continue
        plan = inventory_calc.build_sell_in_plan(
            ending_stock,
            first,
            _months_inclusive(first, until),
            forecast.get(sku, {}),
            target_for,
            shipped.get(sku, {}),
        )
        if not plan:
            without_forecast.append(sku_cols)
            continue
        sku_source = (source or {}).get(sku, {})
        for row in plan:
            rows.append({**sku_cols, **row, "forecast_source": sku_source.get(row["month"], "current")})
    return last_actual, rows, without_forecast


def get_sell_in_plan(
    customer_id: int,
    months: int = inventory_calc.SELL_IN_PLAN_MONTHS,
    skus: list[str] | None = None,
    month: str | None = None,
    forecast_lines: dict | None = None,
) -> dict:
    """
    Recommended sell-in per SKU and future month for one customer (in whole
    cartons: 8 for pants, 12 for tape), with the
    totals per month and per SKU that an order to the factory is built from.
    Each SKU plans from the month after its own last actual month, on that
    SKU's own ending stock, up to `months` months after the current month (the
    page's "Months ahead"). A SKU's actuals run to the customer's last month of
    sell-in (_fetch_actuals), so a SKU with nothing shipped lately still plans
    from the same month as the rest. A SKU with no forecast for its start month cannot be
    planned and is listed in skus_without_forecast instead. `skus` narrows the
    plan to those SKUs; the monthly totals then cover only them. `forecast_lines`
    (forecast_units.get_forecast_lines) skips reading them again, for callers
    that plan every customer from one read.
    """

    # The forecast runs in the background while Postgres answers the rest
    # (see get_customer_view).
    with ThreadPoolExecutor(max_workers=1) as pool:
        with _read_connection() as conn:
            customers = _fetch_customers(conn)
            _require_customers(customers, [customer_id])
            forecast_job = None
            if forecast_lines is None:
                forecast_job = pool.submit(forecast_units.get_forecast_lines, customer_id)
            metrics = _fetch_actuals(conn, [customer_id])
            versions = doh_settings.fetch_versions(conn, [customer_id]).get(customer_id, [])
            shipped = _fetch_shipped(conn, customer_id)

        lines = forecast_lines if forecast_job is None else forecast_job.result()

    threshold = _threshold_view(customer_id, customers[customer_id], versions)
    customer = {"customer_id": customer_id, "customer_name": customers[customer_id]}
    if not metrics:
        return {
            "customer": customer,
            "threshold": threshold,
            "actuals_through": None,
            "actuals_through_by_sku": {},
            "rows": [],
            "monthly_totals": [],
            "sku_totals": [],
            "skus_without_forecast": [],
        }

    details = _sku_details()
    forecast, source, _ = _plan_forecast(lines, details)
    until = inventory_calc.add_months(_current_month(), months)
    last_actual, plan_rows, without_forecast = _sku_plans(
        metrics, forecast, shipped, threshold, until, details, source
    )
    rows = [{**row, "month": _iso(row["month"])} for row in plan_rows]

    if skus:
        rows = [row for row in rows if row["sku"] in skus]
        without_forecast = [cols for cols in without_forecast if cols["sku"] in skus]

    if month:
        target = _parse_month(month)
        rows = [row for row in rows if row["month"] == target.isoformat()]

    rows.sort(key=lambda r: (r["month"], r["product_name"]))

    return {
        "customer": customer,
        "threshold": threshold,
        "actuals_through": _iso(max(month for month, _ in last_actual.values())),
        "actuals_through_by_sku": {sku: _iso(month) for sku, (month, _) in last_actual.items()},
        "rows": rows,
        "monthly_totals": _sum_by(rows, "month"),
        "sku_totals": _sku_totals(rows),
        "skus_without_forecast": sorted(without_forecast, key=lambda c: c["product_name"]),
    }


def _sum_or_none(values: list[float]) -> float | None:
    return round(sum(values), 2) if values else None


def get_sell_in_outlook(
    customer_id: int,
    months: int = inventory_calc.SELL_IN_PLAN_MONTHS,
    skus: list[str] | None = None,
    start_year: int | None = None,
    block_ids: list[int] | None = None,
) -> dict:
    """
    One customer's sell-in and sell-out by month for the sell-in plan chart:
    from January of `start_year` (the page's "Start from") to `months` months
    after the current month (its "Months ahead"), the same end month as the
    plan. `start_year` defaults to the current year; it must be one of
    `start_years` (_start_years), or ValueError. Each SKU is actual up to its own last actual month (the
    customer's last sell-in month, see _fetch_actuals) and then
    uses the plan's recommended sell-in and the forecast sell-out, so a SKU
    only adds to the months its own data covers.

    Sell-in is also planned on the initial forecast alone (same opening
    stock, target and shipments), with no fallback: a SKU stops at its first
    month without it, as the plan does. Like its sell-out line it also covers
    the actual months, with what the initial would have recommended each
    month (_past_recommendations), to read against the sell-in actually sent.

    Previous sell-in is the plan saved after a forecast refresh
    (sell_in_snapshots), so it shows what was actually recommended then
    (_previous_sell_in). A month no saved plan covers falls back to the plan
    worked out on the previous sell-out forecast, covering the actual months
    the same way as the initial line. Months before the previous forecast
    starts are planned on the plan's own forecast, only to carry the stock
    through to it, and are not shown.

    `block_ids` picks saved Scenario builder building blocks for the chart's
    overlay: they are added to the Current sell-out forecast the way the
    Scenario builder's Simulated line adds them (scenario/block_effects), and
    the plan is worked out again on that (sell_out_with_blocks,
    sell_in_with_blocks). A what-if only: the plan, the other lines and the
    saved snapshots never include them.
    """

    current_month = _current_month()
    # The forecast runs in the background while Postgres answers the rest
    # (see get_customer_view).
    with ThreadPoolExecutor(max_workers=1) as pool:
        with _read_connection() as conn:
            customers = _fetch_customers(conn)
            _require_customers(customers, [customer_id])
            forecast_job = pool.submit(forecast_units.get_forecast_lines, customer_id)
            metrics = _fetch_actuals(conn, [customer_id])
            versions = doh_settings.fetch_versions(conn, [customer_id]).get(customer_id, [])
            shipped = _fetch_shipped(conn, customer_id)
            snapshots = _fetch_plan_snapshots(conn, customer_id, current_month)
            blocks = scenario_blocks.fetch_blocks_for_customer(conn, customer_id, block_ids or [])
            budget = budget_service.sellout_for_customer(conn, customer_id)

        lines = forecast_job.result()

    customer = {"customer_id": customer_id, "customer_name": customers[customer_id]}
    metrics = {key: sku_months for key, sku_months in metrics.items() if not skus or key[1] in skus}
    if not metrics:
        return {
            "customer": customer,
            "actuals_through": None,
            "months": [],
            "start_year": None,
            "start_years": [],
            "building_blocks": [],
        }

    threshold = _threshold_view(customer_id, customers[customer_id], versions)
    details = _sku_details()
    forecast, source, initial = _plan_forecast(lines, details)
    previous = _known_skus(lines.get("previous", {}), details)
    budget = _known_skus(budget, details)
    until = inventory_calc.add_months(current_month, months)
    last_actual, plan_rows, _ = _sku_plans(metrics, forecast, shipped, threshold, until, details, source)
    _, initial_rows, _ = _sku_plans(metrics, initial, shipped, threshold, until, details)
    # The previous forecast often starts some months after a SKU's last
    # actual; the plan's forecast bridges that gap so the plan can reach it.
    bridged = {sku: {**forecast.get(sku, {}), **months_} for sku, months_ in previous.items()}
    _, bridged_rows, _ = _sku_plans(metrics, bridged, shipped, threshold, until, details)
    previous_rows = [row for row in bridged_rows if row["month"] in previous.get(row["sku"], {})]
    with_blocks = _plan_with_blocks(metrics, lines, blocks, shipped, threshold, until, details)
    budget_bridged = {sku: {**forecast.get(sku, {}), **months_} for sku, months_ in budget.items()}
    _, budget_rows, _ = _sku_plans(metrics, budget_bridged, shipped, threshold, until, details)
    budget_sell_in = _sell_in_by_month([row for row in budget_rows if row["month"] in budget.get(row["sku"], {})])


    actuals_through = max(month for month, _ in last_actual.values())
    start_years = _start_years(metrics, actuals_through, current_month)
    if start_year is None:
        start_year = current_month.year
    elif start_year not in start_years:
        raise ValueError(
            f"Start from must be one of {', '.join(str(year) for year in start_years)}, not {start_year}."
        )
    year_start = date(start_year, 1, 1)
    window = [inventory_calc.add_months(year_start, offset) for offset in range(_months_inclusive(year_start, until))]

    actual_by_sku = [
        {row["month"]: row for row in inventory_calc.build_monthly_series(sku_months)}
        for sku_months in metrics.values()
    ]
    recommended: dict[date, list[float]] = {}
    forecast_out: dict[date, list[float]] = {}
    sources: dict[date, set[str]] = {}
    for row in plan_rows:
        recommended.setdefault(row["month"], []).append(row["recommended_sell_in"])
        forecast_out.setdefault(row["month"], []).append(row["forecast_sell_out"])
        sources.setdefault(row["month"], set()).add(row["forecast_source"])
    blocks_sell_in = _sell_in_by_month(with_blocks["rows"])
    blocks_sell_out: dict[date, list[float]] = {}
    for row in with_blocks["rows"]:
        blocks_sell_out.setdefault(row["month"], []).append(row["forecast_sell_out"])
    actual_months = {month for month in window if month <= actuals_through}
    past_initial = _past_recommendations(metrics, initial, actual_months, versions, actuals_through)
    past_previous = _past_recommendations(metrics, previous, actual_months, versions, actuals_through)
    for month, values in _past_recommendations(metrics, budget, actual_months, versions, actuals_through).items():
        budget_sell_in.setdefault(month, []).extend(values.values())
    initial_sell_in = _sell_in_by_month(initial_rows)
    previous_worked_out = _sell_in_by_month(previous_rows)
    for past, by_month in ((past_initial, initial_sell_in), (past_previous, previous_worked_out)):
        for month, by_sku in past.items():
            by_month.setdefault(month, []).extend(by_sku.values())

    # The initial and previous lines cover the SKUs in view, actual months
    # included, so they can be read against what actually sold as well as
    # against the plan.
    in_view = {sku for _, sku in metrics}
    previous_sell_in = {
        **previous_worked_out,
        **_previous_sell_in(snapshots, window, current_month, in_view),
    }
    def sell_in_vs_forecast(month: date) -> dict | None:
        recommended_for_month = {
            "saved": _saved_plan_for(snapshots, month, current_month),
            "previous": past_previous.get(month, {}),
            "initial": past_initial.get(month, {}),
        }
        return _sell_in_vs_forecast(metrics, recommended_for_month, month)

    series = []
    for month in window:
        actual = [by_month[month] for by_month in actual_by_sku if month in by_month]
        is_actual = month in actual_months
        series.append(
            {
                "month": _iso(month),
                "sell_in_actual": _sum_or_none([row["sell_in"] for row in actual]),
                "sell_in_recommended": _sum_or_none(recommended.get(month, [])),
                "sell_in_previous": _sum_or_none(previous_sell_in.get(month, [])),
                "sell_in_budget": _sum_or_none(budget_sell_in.get(month, [])),
                "sell_out_budget": _sum_or_none([budget[sku][month] for sku in in_view if month in budget.get(sku, {})]),
                "sell_in_initial": _sum_or_none(initial_sell_in.get(month, [])),
                "sell_out_actual": _sum_or_none([row["sell_out"] for row in actual]),
                "sell_out_forecast": _sum_or_none(forecast_out.get(month, [])),
                "sell_out_initial": _sum_or_none(
                    [initial[sku][month] for sku in in_view if month in initial.get(sku, {})]
                ),
                "sell_out_previous": _sum_or_none(
                    [previous[sku][month] for sku in in_view if month in previous.get(sku, {})]
                ),
                "sell_in_with_blocks": _sum_or_none(blocks_sell_in.get(month, [])),
                "sell_out_with_blocks": _sum_or_none(blocks_sell_out.get(month, [])),
                "forecast_source": _one_source(sources.get(month, set())),
                # Actual months only: the SKU-matched comparison the chart
                # adds up over a picked range (frontend sellInComparison.js).
                "sell_in_vs_forecast": sell_in_vs_forecast(month) if is_actual else None,
                "sell_out_vs_forecast": _sell_out_vs_forecast(metrics, forecast, source, month) if is_actual else None,
            }
        )

    return {
        "customer": customer,
        "actuals_through": _iso(actuals_through),
        "months": series,
        "start_year": start_year,
        "start_years": start_years,
        "last_month_vs_forecast": _sell_out_vs_forecast(metrics, forecast, source, actuals_through),
        "last_month_sell_in_vs_forecast": sell_in_vs_forecast(actuals_through),
        "building_blocks": _blocks_in_window(blocks, with_blocks["deltas"], window),
    }


def _plan_with_blocks(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    lines: dict[str, dict[str, dict[date, float]]],
    blocks: list[dict],
    shipped: dict[str, dict[date, float]],
    threshold: dict,
    until: date,
    details: dict[str, dict],
) -> dict:
    """
    The sell-in plan worked out again with the overlay's building blocks
    added to the Current forecast, and what each block adds to it ({block_id:
    {sku: {month: units}}}, before the blocks are floored together), counted
    only for the SKU x months the plan covers, so it matches the chart.
    Nothing when no block is picked.
    """

    if not blocks:
        return {"rows": [], "deltas": {}}
    in_view = {sku for _, sku in metrics}
    current = {sku: months for sku, months in lines.get("current", {}).items() if sku in in_view}
    adjusted = {**lines, "current": block_effects.apply_blocks(current, blocks)}
    forecast, source, _ = _plan_forecast(adjusted, details)
    _, rows, _ = _sku_plans(metrics, forecast, shipped, threshold, until, details, source)
    planned = {(row["sku"], row["month"]) for row in rows}
    deltas = {
        block["block_id"]: {
            sku: {month: units for month, units in months.items() if (sku, month) in planned}
            for sku, months in block_effects.block_deltas(current, [block]).items()
        }
        for block in blocks
    }
    return {"rows": rows, "deltas": deltas}


def _blocks_in_window(
    blocks: list[dict],
    deltas: dict[int, dict[str, dict[date, float]]],
    window: list[date],
) -> list[dict]:
    """
    Each overlay block with the sell-out it adds over the chart's months
    (`sell_out_change`, units, negative for a decrease), so the page can say
    which ones change nothing here (another SKU, or months with no Current
    forecast).
    """

    shown = set(window)
    return [
        {
            "block_id": block["block_id"],
            "name": block["name"],
            "sell_out_change": round(
                sum(units for months in deltas.get(block["block_id"], {}).values()
                    for month, units in months.items() if month in shown),
                2,
            ),
        }
        for block in blocks
    ]


def _start_years(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    actuals_through: date,
    current_month: date,
) -> list[int]:
    """
    The years the chart can start from: this year and last year (no further
    back, so the chart stays readable), last year only when the customer has
    actuals in or before it, and always the year of the latest actual month,
    even when that is older, so those actuals can still be reached.
    """

    first_actual = min(month for sku_months in metrics.values() for month in sku_months)
    years = {current_month.year, actuals_through.year}
    if first_actual.year <= current_month.year - 1:
        years.add(current_month.year - 1)
    return sorted(years)


def _fetch_plan_snapshots(
    conn: Connection, customer_id: int, before: date
) -> dict[date, dict[date, dict[str, float]]]:
    """One customer's saved sell-in plans taken before `before`, as
    {snapshot_month: {plan_month: {sku: recommended}}} (sell_in_snapshots).
    None saved yet when migration 015 hasn't been run, so the rest of the
    chart still loads."""

    try:
        rows = conn.execute(
            text("""
                SELECT snapshot_month, plan_month, sku, recommended_sell_in
                FROM sell_in_plan_snapshots
                WHERE customer_id = :customer_id AND snapshot_month < :before
            """),
            {"customer_id": customer_id, "before": before},
        ).mappings().all()
    except DatabaseError as exc:
        if "sell_in_plan_snapshots" not in str(exc):
            raise
        return {}

    snapshots: dict[date, dict[date, dict[str, float]]] = {}
    for row in rows:
        plan = snapshots.setdefault(row["snapshot_month"], {}).setdefault(row["plan_month"], {})
        plan[row["sku"]] = float(row["recommended_sell_in"])
    return snapshots


def _previous_sell_in(
    snapshots: dict[date, dict[date, dict[str, float]]],
    window: list[date],
    current_month: date,
    skus: set[str],
) -> dict[date, list[float]]:
    """
    The Previous sell-in line: for each month, what the newest plan saved
    before it recommended. From the current month on that is the plan saved
    last month (or the newest earlier one); for a past month, the plan saved
    before that month began, to read against the sell-in actually sent. A
    month that plan didn't cover is left out (get_sell_in_outlook fills it
    from the previous sell-out forecast).
    """

    by_month: dict[date, list[float]] = {}
    for month in window:
        plan = _saved_plan_for(snapshots, month, current_month)
        values = [value for sku, value in plan.items() if sku in skus]
        if values:
            by_month[month] = values
    return by_month


def _saved_plan_for(
    snapshots: dict[date, dict[date, dict[str, float]]], month: date, current_month: date
) -> dict[str, float]:
    """{sku: recommended} for `month` from the newest plan saved before it
    (before the current month, for a month from then on); {} when none."""

    cutoff = min(month, current_month)
    taken = [snapshot_month for snapshot_month in snapshots if snapshot_month < cutoff]
    return snapshots[max(taken)].get(month, {}) if taken else {}


def _past_recommendations(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    forecast: dict[str, dict[date, float]],
    months: set[date],
    versions: list[dict],
    latest: date,
) -> dict[date, dict[str, float]]:
    """
    For each actual month in `months`, the sell-in the plan's rule would have
    recommended per SKU ({month: {sku: units}}) had it run on `forecast`: that month's real opening
    stock, the forecast for it and the months after, and the target in effect
    at that month's end. Nothing already shipped is taken off (those months
    are closed). A SKU with no forecast for a month adds nothing to it.
    """

    by_month: dict[date, dict[str, float]] = {}
    for (_, sku), sku_months in metrics.items():
        sku_forecast = forecast.get(sku, {})
        for row in inventory_calc.build_monthly_series(sku_months):
            month = row["month"]
            if month not in months:
                continue
            target = _band_for_month(versions, month, latest)["target_doh"]
            plan = inventory_calc.build_sell_in_plan(row["opening_stock"], month, 1, sku_forecast, lambda _: target)
            if plan:
                by_month.setdefault(month, {})[sku] = plan[0]["recommended_sell_in"]
    return by_month


def _sell_in_by_month(plan_rows: list[dict]) -> dict[date, list[float]]:
    by_month: dict[date, list[float]] = {}
    for row in plan_rows:
        by_month.setdefault(row["month"], []).append(row["recommended_sell_in"])
    return by_month


def _one_source(sources: set[str]) -> str | None:
    """"current" / "initial" when every SKU's forecast came from one line, "mixed" otherwise."""

    if not sources:
        return None
    return next(iter(sources)) if len(sources) == 1 else "mixed"


def _sell_out_vs_forecast(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    forecast: dict[str, dict[date, float]],
    source: dict[str, dict[date, str]],
    month: date,
) -> dict | None:
    """
    One actual month's sell-out against what was forecast for it,
    over the SKUs that have both, so the two figures cover the same products.
    The forecast is the same one the plan uses (current where it has the
    month, otherwise the initial). None when no SKU has both.
    """

    actual_total = forecast_total = 0.0
    used: set[str] = set()
    compared = with_actual = 0
    for (_, sku), sku_months in metrics.items():
        series = inventory_calc.build_monthly_series(sku_months)
        actual_row = next((row for row in series if row["month"] == month), None)
        if actual_row is None:
            continue
        with_actual += 1
        if month not in forecast.get(sku, {}):
            continue
        compared += 1
        actual_total += actual_row["sell_out"]
        forecast_total += forecast[sku][month]
        used.add(source[sku][month])
    if not used:
        return None

    difference = actual_total - forecast_total
    return {
        "month": _iso(month),
        "actual": round(actual_total, 2),
        "forecast": round(forecast_total, 2),
        "forecast_source": _one_source(used),
        "difference": round(difference, 2),
        "percent": round(difference / forecast_total * 100, 2) if forecast_total else None,
        "skus_compared": compared,
        "skus_with_actuals": with_actual,
    }


def _sell_in_vs_forecast(
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    recommended: dict[str, dict[str, float]],
    month: date,
) -> dict | None:
    """
    One actual month's sell-in against what was recommended for it,
    over the SKUs that have both. Per SKU the recommendation is, in order: the
    plan saved before that month (`saved`), the one worked out on the
    previous sell-out forecast (`previous`), then on the initial
    (`initial`), the Previous sell-in line first and the initial where it has
    nothing. Same shape as _sell_out_vs_forecast; forecast_source is
    'previous', 'initial' or 'mixed'. None when no SKU has both.
    """

    actual_total = forecast_total = 0.0
    used: set[str] = set()
    compared = with_actual = 0
    for (_, sku), sku_months in metrics.items():
        actual_row = next(
            (row for row in inventory_calc.build_monthly_series(sku_months) if row["month"] == month), None
        )
        if actual_row is None:
            continue
        with_actual += 1
        value = kind = None
        for key, line in (("saved", "previous"), ("previous", "previous"), ("initial", "initial")):
            if sku in recommended[key]:
                value, kind = recommended[key][sku], line
                break
        if value is None:
            continue
        compared += 1
        actual_total += actual_row["sell_in"]
        forecast_total += value
        used.add(kind)
    if not used:
        return None

    difference = actual_total - forecast_total
    return {
        "month": _iso(month),
        "actual": round(actual_total, 2),
        "forecast": round(forecast_total, 2),
        "forecast_source": _one_source(used),
        "difference": round(difference, 2),
        "percent": round(difference / forecast_total * 100, 2) if forecast_total else None,
        "skus_compared": compared,
        "skus_with_actuals": with_actual,
    }


def _parse_month(value: str) -> date:
    try:
        return date.fromisoformat(f"{value[:7]}-01")
    except ValueError:
        raise ValueError(f"month must look like 2026-10, not {value!r}.")


def _sum_by(rows: list[dict], key: str) -> list[dict]:
    """Forecast, recommended sell-in and projected stock summed per `key` (month)."""

    totals: dict[str, dict] = {}
    for row in rows:
        entry = totals.setdefault(
            row[key],
            {
                key: row[key],
                "forecast_sell_out": 0.0,
                "shipped_so_far": 0.0,
                "recommended_sell_in": 0,
                "projected_ending_stock": 0.0,
            },
        )
        entry["forecast_sell_out"] += row["forecast_sell_out"]
        entry["shipped_so_far"] += row["shipped_so_far"]
        entry["recommended_sell_in"] += row["recommended_sell_in"]
        entry["projected_ending_stock"] += row["projected_ending_stock"]

    return [
        {
            **entry,
            "forecast_sell_out": round(entry["forecast_sell_out"], 2),
            "shipped_so_far": round(entry["shipped_so_far"], 2),
            "projected_ending_stock": round(entry["projected_ending_stock"], 2),
        }
        for entry in sorted(totals.values(), key=lambda e: e[key])
    ]


def _sku_totals(rows: list[dict]) -> list[dict]:
    """Recommended sell-in per SKU over the whole plan, largest first: what to order, by item."""

    totals: dict[str, dict] = {}
    for row in rows:
        entry = totals.setdefault(
            row["sku"],
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "sku_range": row["sku_range"],
                "size": row["size"],
                "recommended_sell_in": 0,
            },
        )
        entry["recommended_sell_in"] += row["recommended_sell_in"]

    return sorted(totals.values(), key=lambda e: (-e["recommended_sell_in"], e["product_name"]))


# ============================================================
# CREATE / EDIT INVENTORY DATA
#
# Both write manual_entry rows, so the workbook rows are never
# changed or lost; reads then prefer the manual value. Create refuses a
# customer, SKU and month that already has data; edit refuses one that
# has none.
# ============================================================

_CUSTOMERS_WITH_MONTH_SQL = """
    SELECT DISTINCT
        customer_id

    FROM inventory_metrics

    WHERE
        customer_id = ANY(CAST(:customer_ids AS integer[]))
        AND sku = :sku
        AND period_start = :month
        AND metric_name IN ('sell_in', 'sell_out_base', 'sell_out_building_blocks')
        AND NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')
"""

_CUSTOMERS_WITH_EARLIER_MONTH_SQL = """
    SELECT DISTINCT
        customer_id

    FROM inventory_metrics

    WHERE
        customer_id = ANY(CAST(:customer_ids AS integer[]))
        AND sku = :sku
        AND period_start < :month
        AND NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')
"""

_WRITE_METRICS_SQL = """
    INSERT INTO inventory_metrics (
        customer_id,
        sku,
        period_start,
        period_end,
        metric_name,
        metric_value,
        value_type,
        as_of_date,
        data_source
    )
    SELECT
        customer_id,
        CAST(:sku AS varchar),
        CAST(:period_start AS date),
        CAST(:period_end AS date),
        metric_name,
        metric_value,
        value_type,
        CAST(:as_of_date AS date),
        CAST(:data_source AS varchar)

    FROM unnest(
        CAST(:customer_ids AS integer[]),
        CAST(:metric_names AS text[]),
        CAST(:metric_values AS double precision[]),
        CAST(:value_types AS text[])
    ) AS input(
        customer_id,
        metric_name,
        metric_value,
        value_type
    )

    ON CONFLICT (
        customer_id,
        sku,
        period_start,
        metric_name,
        value_type,
        as_of_date,
        data_source
    )
    DO UPDATE SET
        metric_value = EXCLUDED.metric_value,
        loaded_at = CURRENT_TIMESTAMP
"""


def _metric_values(record) -> dict[str, float]:
    values = {"sell_in": record.sell_in}
    if record.opening_inventory is not None:
        values["opening_inventory"] = record.opening_inventory
    if record.building_blocks is not None:
        values["sell_out_building_blocks"] = record.building_blocks
    return values


def _write_record(conn: Connection, record, today: date) -> int:
    entries = [
        (metric_name, value, _VALUE_TYPES[metric_name])
        for metric_name, value in _metric_values(record).items()
    ]
    return _write_metrics(conn, record.customer_ids, record.sku, record.month, entries, today)


def _write_metrics(
    conn: Connection,
    customer_ids: list[int],
    sku: str,
    month: date,
    entries: list[tuple[str, float, str]],
    today: date,
) -> int:
    """
    Upsert (metric_name, value, value_type) entries for one SKU and month
    across every customer, in one statement, as manual_entry rows.
    """

    ids, metric_names, metric_values, value_types = [], [], [], []
    for customer_id in customer_ids:
        for metric_name, value, value_type in entries:
            ids.append(customer_id)
            metric_names.append(metric_name)
            metric_values.append(float(value))
            value_types.append(value_type)

    conn.execute(
        text(_WRITE_METRICS_SQL),
        {
            "sku": sku,
            "period_start": month,
            "period_end": _month_end(month),
            "as_of_date": today,
            "data_source": MANUAL_DATA_SOURCE,
            "customer_ids": ids,
            "metric_names": metric_names,
            "metric_values": metric_values,
            "value_types": value_types,
        },
    )
    return len(metric_names)


def _require_sellout_coverage(conn: Connection, record) -> None:
    """
    Sell-out for the month comes from the sales dashboard's data, so the month
    can only become an actual once that data covers all of it.
    """

    retailers = _fetch_customer_retailers(conn, record.customer_ids)
    for customer_id in record.customer_ids:
        _, data_through = sellout_units.get_monthly_sellout(retailers.get(customer_id, []), conn=conn)
        if data_through is None or data_through < _month_end(record.month):
            covered = f"only loaded through {data_through:%d %b %Y}" if data_through else "not loaded yet"
            raise ValueError(
                f"Sell-out for {record.month:%B %Y} comes from the sales dashboard data, which is "
                f"{covered}. Enter this month once the data covers it."
            )


def _product_name(conn: Connection, sku: str) -> str:
    """The catalog's product name for a SKU code, for messages people read."""

    row = conn.execute(text("SELECT product_name FROM skus WHERE sku = :sku"), {"sku": sku}).first()
    if row is None:
        raise SkuNotFoundError(f"SKU {sku} is not in the catalog.")
    return row[0] or sku


def _validate_record_target(
    conn: Connection, record, customers: dict[int, str], today: date
) -> tuple[set[int], str]:
    """
    Checks shared by create and edit; returns the customers that already have
    this month and the product's name for messages.
    """

    _require_customers(customers, record.customer_ids)

    if _month_end(record.month) >= today:
        raise ValueError(
            f"{record.month:%B %Y} has not ended yet, and actuals can only be entered for a "
            "finished month. Use Temporary sell-in to record sell-in already sent this month."
        )

    _require_sellout_coverage(conn, record)

    product = _product_name(conn, record.sku)

    params = {
        "customer_ids": record.customer_ids,
        "sku": record.sku,
        "month": record.month,
    }

    if record.opening_inventory is not None:
        earlier = conn.execute(text(_CUSTOMERS_WITH_EARLIER_MONTH_SQL), params).all()
        if earlier:
            raise ValueError(
                "Opening inventory can only be set for a SKU's first month; "
                "later months take their opening stock from the previous month's ending stock."
            )

    existing = {row[0] for row in conn.execute(text(_CUSTOMERS_WITH_MONTH_SQL), params).all()}
    return existing, product


def _names(customers: dict[int, str], ids) -> str:
    return ", ".join(customers[i] for i in sorted(ids))


# ============================================================
# LOW-STOCK NOTIFICATIONS
#
# Checked after a write touches sell-in, so a SKU that drops below its
# customer's DOH floor raises an in-system alert without anyone having to
# keep the Inventory page open. Best-effort: the forecast needed to compute
# DOH is a BigQuery read, and must never be able to break a write that is
# otherwise Postgres-only, so any failure here is swallowed, not raised.
# ============================================================


def _notify_low_stock(conn: Connection, customer_id: int, skus: list[str], today: date) -> None:
    try:
        # Through the same conn as the write (not settings/doh.get_settings,
        # which opens its own connection) so this never needs network beyond
        # what the write itself already opened, and so a customer with alerts
        # off never even reaches the forecast lookup below.
        alert_row = conn.execute(
            text("SELECT doh_alert_enabled FROM customers WHERE customer_id = :customer_id"),
            {"customer_id": customer_id},
        ).first()
        if alert_row is None or not alert_row[0]:
            return

        customers = _fetch_customers(conn)
        metrics = _fetch_actuals(conn, [customer_id])
        latest = _latest_month_by_customer(metrics).get(customer_id)
        if latest is None:
            return

        details = _sku_details()
        forecast = _forecast_by_sku(customer_id, details)
        versions = doh_settings.fetch_versions(conn, [customer_id]).get(customer_id, [])

        table = _customer_table(
            customer_id,
            customers[customer_id],
            metrics,
            versions,
            details,
            forecast,
            skus=skus,
            start_month=latest,
            end_month=latest,
        )
        below_min = [row for row in table if row["doh_status"] == inventory_calc.DOH_STATUS_BELOW_MIN]
        if not below_min:
            return

        already = notification_service.already_alerted_skus(conn, customer_id)
        new_items = [
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "customer_name": row["customer_name"],
                "current_stock": round(row["ending_stock"]),
                "doh_threshold": row["min_doh"],
                "doh_remaining": row["doh"],
                "last_update": _iso(today),
            }
            for row in below_min
            if row["sku"] not in already
        ]
        if not new_items:
            return

        if len(new_items) >= notification_service.CONSOLIDATE_AT:
            notification_service.insert(
                notification_service.LOW_STOCK,
                {"count": len(new_items), "items": new_items},
                customer_id=customer_id,
                skus=[item["sku"] for item in new_items],
                conn=conn,
            )
        else:
            for item in new_items:
                notification_service.insert(
                    notification_service.LOW_STOCK,
                    item,
                    customer_id=customer_id,
                    skus=[item["sku"]],
                    conn=conn,
                )
    except Exception:
        pass


def create_records(record, today: date | None = None) -> dict:
    today = today or _utc_today()
    with _get_engine().begin() as conn:
        customers = _fetch_customers(conn)
        existing, product = _validate_record_target(conn, record, customers, today)
        if existing:
            raise InventoryConflictError(
                f"Inventory for {product} in {record.month:%Y-%m} already exists for "
                f"{_names(customers, existing)}. Use edit to change it."
            )
        written = _write_record(conn, record, today)
        for customer_id in record.customer_ids:
            _notify_low_stock(conn, customer_id, [record.sku], today)

    return _write_summary(record, written)


def update_records(record, today: date | None = None) -> dict:
    today = today or _utc_today()
    with _get_engine().begin() as conn:
        customers = _fetch_customers(conn)
        existing, product = _validate_record_target(conn, record, customers, today)
        missing = set(record.customer_ids) - existing
        if missing:
            raise InventoryNotFoundError(
                f"No inventory for {product} in {record.month:%Y-%m} exists for "
                f"{_names(customers, missing)}. Use create to add it."
            )
        written = _write_record(conn, record, today)
        for customer_id in record.customer_ids:
            _notify_low_stock(conn, customer_id, [record.sku], today)

    return _write_summary(record, written)


def _write_summary(record, written: int) -> dict:
    return {
        "customer_ids": record.customer_ids,
        "sku": record.sku,
        "month": record.month.isoformat(),
        "records_written": written,
    }


# ============================================================
# TEMPORARY SELL-IN (stored and exposed as shipped_so_far)
#
# Sell-in already sent in a month that has not ended, per customer, SKU and
# month. It is stored as a sell_in row marked manual_plan (never an actual),
# so the actuals and the ending-stock history are untouched; only the
# sell-in plan reads it, taking it off the recommended sell-in. Once the month
# ends its real totals go in through create/edit and this figure is ignored.
# ============================================================

_LATEST_ACTUAL_MONTH_SQL = """
    SELECT
        customer_id,
        MAX(period_start)

    FROM inventory_metrics

    WHERE
        customer_id = ANY(CAST(:customer_ids AS integer[]))
        AND sku = :sku
        AND metric_name IN ('sell_in', 'sell_out_base', 'sell_out_building_blocks')
        AND NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')

    GROUP BY
        customer_id
"""


_SHIPPED_SO_FAR_FOR_MONTH_SQL = """
    SELECT DISTINCT ON (customer_id)
        customer_id,
        metric_value

    FROM inventory_metrics

    WHERE
        customer_id = ANY(CAST(:customer_ids AS integer[]))
        AND sku = :sku
        AND period_start = :month
        AND metric_name = 'sell_in'
        AND value_type = 'manual_plan'

    ORDER BY
        customer_id,
        as_of_date DESC,
        loaded_at DESC
"""


def get_shipped_so_far(customer_ids: list[int], sku: str, month: date) -> list[dict]:
    """
    Current temporary sell-in for one SKU and month, per customer -- what
    saving again on that form would overwrite. A customer with no entry reads
    as 0, the same value saving 0 means (it clears the entry), so there is no
    separate "nothing entered yet" state to show.

    Filters by sku and month in SQL (unlike _fetch_shipped, which reads every
    SKU and month for a customer -- needed by the sell-in plan, but wasteful
    here where only one cell is ever read).
    """

    month = inventory_calc.month_start(month)
    with _read_connection() as conn:
        customers = _fetch_customers(conn)
        _require_customers(customers, customer_ids)
        rows = conn.execute(
            text(_SHIPPED_SO_FAR_FOR_MONTH_SQL),
            {"customer_ids": customer_ids, "sku": sku, "month": month},
        ).mappings().all()
        shipped = {row["customer_id"]: row["metric_value"] for row in rows}
        return [
            {
                "customer_id": customer_id,
                "customer_name": customers[customer_id],
                "shipped_so_far": int(shipped.get(customer_id, 0.0)),
            }
            for customer_id in customer_ids
        ]


def set_shipped_so_far(record, today: date | None = None) -> dict:
    """
    Record (or correct) units already shipped for a SKU and month. Entering it
    again replaces the earlier figure; 0 clears it. Refused for a month that
    already has actual data for that SKU, which belongs in create/edit.
    """

    today = today or _utc_today()
    with _get_engine().begin() as conn:
        customers = _fetch_customers(conn)
        _require_customers(customers, record.customer_ids)

        product = _product_name(conn, record.sku)

        latest = dict(
            conn.execute(
                text(_LATEST_ACTUAL_MONTH_SQL),
                {"customer_ids": record.customer_ids, "sku": record.sku},
            ).all()
        )
        already_actual = [c for c in record.customer_ids if latest.get(c) and record.month <= latest[c]]
        if already_actual:
            raise ValueError(
                f"{record.month:%B %Y} already has actual data for {product} for "
                f"{_names(customers, already_actual)}. Temporary sell-in is only for months after "
                "the SKU's latest actuals; change actuals with Edit."
            )

        written = _write_metrics(
            conn,
            record.customer_ids,
            record.sku,
            record.month,
            [("sell_in", record.shipped_so_far, "manual_plan")],
            today,
        )

    return {
        "customer_ids": record.customer_ids,
        "sku": record.sku,
        "month": record.month.isoformat(),
        "shipped_so_far": record.shipped_so_far,
        "records_written": written,
    }


# ============================================================
# SELL-IN UPLOAD
#
# The sell-in tracker's qty in packs, per customer, month and SKU, written as
# actual sell-in (manual_entry, so it replaces what was entered or loaded
# before). A line is skipped rather than guessed at when its customer, product
# or month cannot be matched, the month has not ended, or its sell-out is not
# loaded yet.
# ============================================================


def _plan_sell_in_upload(conn: Connection, data: bytes, today: date) -> tuple[list[dict], list[dict]]:
    customers = _fetch_customers(conn)
    # A tracker name matches a customer by its name or by the family its sales
    # are filed under (CUSTOMER_ALIASES map to those), both compared by
    # customer_match_key: spelling, spacing and company endings don't matter,
    # and a renamed customer record (Sheng_Shiong vs sheng_siong) still matches.
    # A name that fits two customers, by either route, is skipped, never guessed.
    by_name = _customers_by_match_key([(name, customer_id) for customer_id, name in customers.items()])
    by_family = _customers_by_match_key(_fetch_customer_families(conn))
    details = _sku_details()
    sku_by_product = {info["product_name"]: sku for sku, info in details.items()}

    skipped: dict[tuple, dict] = {}

    def skip(reason: str, line: dict) -> None:
        key = (reason, line["customer_name"], line["month"], line["description"])
        entry = skipped.setdefault(
            key,
            {
                "reason": reason,
                "customer_name": line["customer_name"],
                "month": _iso(line["month"]),
                "description": line["description"],
                "lines": 0,
                "qty": 0.0,
            },
        )
        entry["lines"] += 1
        entry["qty"] += line["qty"] or 0.0

    candidates = []
    for line in read_sell_in_lines(data):
        key = customer_match_key(canonical_customer_name(line["customer_name"]))
        matched = by_name.get(key, set()) | by_family.get(key, set())
        if len(matched) > 1:
            skip("Customer name matches more than one customer", line)
            continue
        if not matched:
            skip("Customer is not in inventory", line)
            continue
        # Exactly one customer is left after the two checks above.
        customer_id = next(iter(matched))
        if line["month"] is None:
            skip("Month of sales or invoice year is not recognised", line)
            continue
        problem = quantity_problem(line["qty"])
        if problem:
            skip(problem, line)
            continue
        product = product_for_description(line["description"])
        if product is None or product not in sku_by_product:
            skip("Product description is not recognised", line)
            continue
        candidates.append((line, customer_id, sku_by_product[product]))

    retailers = _fetch_customer_retailers(conn, sorted({customer_id for _, customer_id, _ in candidates}))
    data_through = {
        customer_id: sellout_units.get_monthly_sellout(retailers.get(customer_id, []), conn=conn)[1]
        for customer_id in retailers
    }

    totals: dict[tuple[int, date, str], float] = {}
    for line, customer_id, sku in candidates:
        if _month_end(line["month"]) >= today:
            skip("Month has not ended", line)
        elif data_through.get(customer_id) is None or data_through[customer_id] < _month_end(line["month"]):
            skip("Sell-out for this month is not loaded yet", line)
        else:
            key = (customer_id, line["month"], sku)
            totals[key] = totals.get(key, 0.0) + line["qty"]

    current = _fetch_actuals(conn, sorted({customer_id for customer_id, _, _ in totals}))
    rows = []
    for (customer_id, month, sku), qty in totals.items():
        before = current.get((customer_id, sku), {}).get(month, {}).get("sell_in")
        qty = round(qty, 2)
        if before is None:
            status = "new"
        elif round(before, 2) == qty:
            status = "unchanged"
        else:
            status = "changed"
        rows.append(
            {
                "customer_id": customer_id,
                "customer_name": customers[customer_id],
                "month": month,
                "sku": sku,
                "product_name": details[sku]["product_name"],
                "qty": qty,
                "current": before,
                "status": status,
            }
        )
    rows.sort(key=lambda r: (r["customer_name"], r["month"], r["product_name"]))
    return rows, sorted(skipped.values(), key=lambda s: (s["customer_name"], s["month"] or "", s["reason"]))


def preview_sell_in_upload(data: bytes, today: date | None = None) -> dict:
    today = today or _utc_today()
    with _read_connection() as conn:
        rows, skipped = _plan_sell_in_upload(conn, data, today)

    counts = {"new": 0, "changed": 0, "unchanged": 0}
    for row in rows:
        counts[row["status"]] += 1
    return {
        "counts": counts,
        "rows": [{**row, "month": _iso(row["month"])} for row in rows],
        "skipped": skipped,
    }


def apply_sell_in_upload(data: bytes, today: date | None = None) -> dict:
    today = today or _utc_today()
    with _get_engine().begin() as conn:
        rows, _ = _plan_sell_in_upload(conn, data, today)
        changed = [row for row in rows if row["status"] != "unchanged"]
        for row in changed:
            _write_metrics(
                conn,
                [row["customer_id"]],
                row["sku"],
                row["month"],
                [("sell_in", row["qty"], _VALUE_TYPES["sell_in"])],
                today,
            )

        # Every matched SKU is checked, not just the ones that changed: a SKU
        # already sitting below its threshold still deserves an alert the
        # first time an upload touches it, even if the number it confirms is
        # the same one already on file.
        touched_skus: dict[int, set[str]] = {}
        for row in rows:
            touched_skus.setdefault(row["customer_id"], set()).add(row["sku"])

        for customer_id, skus in touched_skus.items():
            _notify_low_stock(conn, customer_id, sorted(skus), today)

    return {"records_written": len(changed), "unchanged": len(rows) - len(changed)}
