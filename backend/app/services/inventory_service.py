from calendar import monthrange
from datetime import date
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import catalog_service, forecast_units, inventory_calc, sellout_units, sql


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

# Only these two are read from inventory_metrics. Sell-out is not: it comes from
# the same weekly sales data as the dashboard (see _fetch_actuals), so the
# sell_out_base / sell_out_building_blocks rows the workbook load left in the
# table are ignored.
INVENTORY_METRICS = (
    "opening_inventory",
    "sell_in",
)

# Rows written from the app carry this data_source so they never collide with
# (or overwrite) the rows loaded from the inventory workbook.
MANUAL_DATA_SOURCE = "manual_entry"

# value_type per metric for a manual write of actuals.
_VALUE_TYPES = {
    "opening_inventory": "actual",
    "sell_in": "actual",
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
    Actuals per {(customer_id, sku): {month: {metric: value}}}: sell-in and the
    first month's opening from inventory_metrics, sell-out from the sales
    dashboard's weekly data (each week counted in the month it starts, a SKU
    with no sales that month is 0). A month is only kept once the sales data
    covers all of it, so a half-loaded month never counts as actual.
    """

    metrics = _fetch_metrics(conn, customer_ids)
    retailers = _fetch_customer_retailers(conn, sorted({customer for customer, _ in metrics}))
    sales = {
        customer: sellout_units.get_monthly_sellout(retailer_ids)
        for customer, retailer_ids in retailers.items()
    }

    actuals: dict[tuple[int, str], dict[date, dict[str, float]]] = {}
    for (customer_id, sku), months in metrics.items():
        units, data_through = sales.get(customer_id, ({}, None))
        by_month = {}
        for month, values in months.items():
            if data_through is None or data_through < _month_end(month):
                continue
            by_month[month] = {**values, "sell_out_base": units.get(sku, {}).get(month, 0.0)}
        if by_month:
            actuals[(customer_id, sku)] = by_month
    return actuals


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


def _forecast_by_sku(customer_id: int, details: dict[str, dict]) -> dict[str, dict[date, float]]:
    """Predicted units keyed by SKU code; a product the catalog cannot map is skipped."""

    sku_by_name = {info["product_name"]: sku for sku, info in details.items()}
    by_sku: dict[str, dict[date, float]] = {}
    for product_name, months in forecast_units.get_forecast_units(customer_id).items():
        sku = sku_by_name.get(product_name)
        if sku is not None:
            by_sku[sku] = months
    return by_sku


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
        "sell_out": row["sell_out"],
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
# customer_doh_targets is effective-dated and only read here; nothing in
# the app writes it. Min and max are not stored;
# they are always the target -/+ inventory_calc.DOH_BAND_DAYS.
# A customer with no row falls back to the global default.
# ============================================================

_TARGET_COLUMNS = """
    customer_id,
    effective_from,
    effective_to,
    target_doh,
    source,
    created_at
"""


def _fetch_targets(conn: Connection, customer_id: int | None = None) -> list[dict]:
    rows = conn.execute(
        text(
            f"""
            SELECT
                {_TARGET_COLUMNS}

            FROM customer_doh_targets

            WHERE
                (
                    CAST(:customer_id AS integer) IS NULL
                    OR customer_id = CAST(:customer_id AS integer)
                )

            ORDER BY
                customer_id ASC,
                effective_from DESC
            """
        ),
        {"customer_id": customer_id},
    ).mappings().all()

    return [dict(row) for row in rows]


def _target_in_effect(targets: list[dict], on: date) -> dict | None:
    for target in targets:
        if target["effective_from"] <= on and (
            target["effective_to"] is None or target["effective_to"] >= on
        ):
            return target
    return None


def _threshold_view(customer_id: int, customer_name: str, targets: list[dict], on: date) -> dict:
    target_row = _target_in_effect(targets, on)
    target = (
        target_row["target_doh"] if target_row else float(inventory_calc.DEFAULT_TARGET_DOH)
    )
    minimum, maximum = inventory_calc.threshold_band(target)
    return {
        "customer_id": customer_id,
        "customer_name": customer_name,
        "min_doh": minimum,
        "target_doh": target,
        "max_doh": maximum,
        "is_global_default": target_row is None,
        "last_updated": target_row["created_at"].isoformat() if target_row else None,
        "source": target_row["source"] if target_row else None,
    }


# ============================================================
# CUSTOMER VIEW (one customer, with DOH)
# ============================================================


def _customer_table(
    customer_id: int,
    customer_name: str,
    metrics: dict[tuple[int, str], dict[date, dict[str, float]]],
    targets: list[dict],
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
                    **_target_columns(targets, row["month"], row["doh"]),
                }
            )

    table.sort(key=lambda r: (r["month"], r["sku"]))
    return table


def get_customer_view(
    customer_id: int,
    skus: list[str] | None = None,
    start_month: date | None = None,
    end_month: date | None = None,
    today: date | None = None,
) -> dict:
    """
    One customer's stock with DOH: a trend row per month (combined DOH
    against that month's target and band) and one table row per SKU and
    month with the gap to target. Each month is measured against the
    target that was in effect at the end of that month.
    """

    today = today or date.today()
    with _read_connection() as conn:
        customers = _fetch_customers(conn)
        _require_customers(customers, [customer_id])
        metrics = _fetch_actuals(conn, [customer_id])
        targets = _fetch_targets(conn, customer_id)

    details = _sku_details()
    forecast = _forecast_by_sku(customer_id, details)

    table = _customer_table(
        customer_id,
        customers[customer_id],
        metrics,
        targets,
        details,
        forecast,
        skus=skus,
        start_month=start_month,
        end_month=end_month,
    )

    by_month: dict[str, list[dict]] = {}
    for row in table:
        by_month.setdefault(row["month"], []).append(row)

    trend = []
    for month, rows in by_month.items():
        doh = inventory_calc.combined_doh(rows)
        trend.append(
            {
                "month": month,
                "ending_stock": round(sum(r["ending_stock"] for r in rows), 2),
                "doh": doh,
                **_target_columns(targets, date.fromisoformat(month), doh),
            }
        )

    return {
        "customer": {"customer_id": customer_id, "customer_name": customers[customer_id]},
        "threshold": _threshold_view(customer_id, customers[customer_id], targets, today),
        "trend": trend,
        "skus": table,
    }


def _target_columns(targets: list[dict], month: date, doh: float | None) -> dict:
    """Target, band, gap and status for a month, judged at the month's end."""

    target_row = _target_in_effect(targets, _month_end(month))
    target = (
        target_row["target_doh"] if target_row else float(inventory_calc.DEFAULT_TARGET_DOH)
    )
    minimum, maximum = inventory_calc.threshold_band(target)
    return {
        "target_doh": target,
        "min_doh": minimum,
        "max_doh": maximum,
        "doh_vs_target": None if doh is None else round(doh - target, 1),
        "doh_status": inventory_calc.threshold_status(doh, target),
    }


# ============================================================
# AT RISK (all customers)
#
# A SKU is at risk when its days of holding, in the customer's latest month
# of actuals, is outside the customer's min-max band: below min (low stock)
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

    with _read_connection() as conn:
        customers = _fetch_customers(conn)
        chosen = customer_ids or list(customers)
        _require_customers(customers, chosen)
        metrics = _fetch_actuals(conn, chosen)
        all_targets = _fetch_targets(conn)

    details = _sku_details()
    latest = _latest_month_by_customer(metrics)

    items = []
    for customer_id in chosen:
        if customer_id not in latest:
            continue
        table = _customer_table(
            customer_id,
            customers[customer_id],
            {key: months for key, months in metrics.items() if key[0] == customer_id},
            [t for t in all_targets if t["customer_id"] == customer_id],
            details,
            _forecast_by_sku(customer_id, details),
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


def get_sell_in_plan(
    customer_id: int,
    months: int = inventory_calc.SELL_IN_PLAN_MONTHS,
    today: date | None = None,
    skus: list[str] | None = None,
) -> dict:
    """
    Recommended sell-in per SKU and future month for one customer (in whole
    cartons: 8 for pants, 12 for tape), with the
    totals per month and per SKU that an order to the factory is built from.
    Each SKU plans `months` months from the month after its own last actual
    month, on that SKU's own ending stock, so entering actuals for only some
    SKUs moves only those. A SKU with no forecast for its start month cannot be
    planned and is listed in skus_without_forecast instead. `skus` narrows the
    plan to those SKUs; the monthly totals then cover only them.
    """

    today = today or date.today()
    with _read_connection() as conn:
        customers = _fetch_customers(conn)
        _require_customers(customers, [customer_id])
        metrics = _fetch_actuals(conn, [customer_id])
        targets = _fetch_targets(conn, customer_id)
        shipped = _fetch_shipped(conn, customer_id)

    threshold = _threshold_view(customer_id, customers[customer_id], targets, today)
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
    forecast = _forecast_by_sku(customer_id, details)

    def target_for(month: date) -> float:
        return _target_columns(targets, month, None)["target_doh"]

    # Each SKU's own last actual month and the stock it ended that month with.
    last_actual = {}
    for (_, sku), sku_months in metrics.items():
        last = inventory_calc.build_monthly_series(sku_months)[-1]
        last_actual[sku] = (last["month"], last["ending_stock"])

    rows = []
    without_forecast = []
    for sku, (last_month, ending_stock) in last_actual.items():
        sku_cols = _sku_columns(sku, details)
        plan = inventory_calc.build_sell_in_plan(
            ending_stock,
            inventory_calc.add_months(last_month, 1),
            months,
            forecast.get(sku, {}),
            target_for,
            shipped.get(sku, {}),
            pack_size=inventory_calc.pack_size_for(sku_cols["product_name"], sku_cols["sku_range"]),
        )
        if not plan:
            without_forecast.append(sku_cols)
            continue
        for row in plan:
            rows.append({**sku_cols, **row, "month": _iso(row["month"])})

    if skus:
        rows = [row for row in rows if row["sku"] in skus]
        without_forecast = [cols for cols in without_forecast if cols["sku"] in skus]

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
        AND metric_name IN ('sell_in', 'sell_out_base')
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
        _, data_through = sellout_units.get_monthly_sellout(retailers.get(customer_id, []))
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


def create_records(record, today: date | None = None) -> dict:
    today = today or date.today()
    with _get_engine().begin() as conn:
        customers = _fetch_customers(conn)
        existing, product = _validate_record_target(conn, record, customers, today)
        if existing:
            raise InventoryConflictError(
                f"Inventory for {product} in {record.month:%Y-%m} already exists for "
                f"{_names(customers, existing)}. Use edit to change it."
            )
        written = _write_record(conn, record, today)

    return _write_summary(record, written)


def update_records(record, today: date | None = None) -> dict:
    today = today or date.today()
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
        AND metric_name IN ('sell_in', 'sell_out_base')
        AND NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')

    GROUP BY
        customer_id
"""


def set_shipped_so_far(record, today: date | None = None) -> dict:
    """
    Record (or correct) units already shipped for a SKU and month. Entering it
    again replaces the earlier figure; 0 clears it. Refused for a month that
    already has actual data for that SKU, which belongs in create/edit.
    """

    today = today or date.today()
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
