"""
Saves the sell-in plan after each forecast refresh (sell_in_plan_snapshots),
so the sell-in plan chart can show "Sell-in Forecast (Previous)": what the
platform actually recommended last month, read back by
inventory_service.get_sell_in_outlook.

Called when a refresh retrains: the event-triggered refresh
(forecast_refresh_worker).
scripts/refresh_forecast.py writes the legacy P&L table, which the plan does
not read, so it takes no snapshot.
"""

import logging
from datetime import date
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.services import forecast_units, inventory_service, sql

logger = logging.getLogger("uvicorn.error")

# The furthest "Months ahead" the page offers (routers/inventory.py, le=12),
# so any view of the chart is covered.
SNAPSHOT_MONTHS = 12


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    return sql.connect_with_connector()


def _replace_snapshot(customer_id: int, snapshot_month: date, rows: list[dict]) -> None:
    # A second refresh in the same month replaces that month's snapshot, SKUs
    # and months that dropped out of the plan included.
    with _get_engine().begin() as conn:
        conn.execute(
            text("""
                DELETE FROM sell_in_plan_snapshots
                WHERE customer_id = :customer_id AND snapshot_month = :snapshot_month
            """),
            {"customer_id": customer_id, "snapshot_month": snapshot_month},
        )
        if rows:
            conn.execute(
                text("""
                    INSERT INTO sell_in_plan_snapshots
                        (customer_id, sku, snapshot_month, plan_month, recommended_sell_in)
                    VALUES (:customer_id, :sku, :snapshot_month, :plan_month, :recommended_sell_in)
                """),
                [
                    {
                        "customer_id": customer_id,
                        "sku": row["sku"],
                        "snapshot_month": snapshot_month,
                        "plan_month": date.fromisoformat(row["month"]),
                        "recommended_sell_in": row["recommended_sell_in"],
                    }
                    for row in rows
                ],
            )


def take_snapshot() -> dict:
    """
    Saves every customer's sell-in plan, all SKUs, as far ahead as the page
    can show (SNAPSHOT_MONTHS), under the current month. One customer
    failing doesn't stop the others; it is logged and listed in `failed`.
    The forecast is read once and shared, so the time this adds to a refresh
    doesn't grow with the number of customers.
    """

    snapshot_month = inventory_service._current_month()
    saved, failed = [], []
    customers = inventory_service.list_customers()
    lines = forecast_units.get_forecast_lines_by_customer([customer["customer_id"] for customer in customers])
    for customer in customers:
        customer_id = customer["customer_id"]
        try:
            plan = inventory_service.get_sell_in_plan(
                customer_id, months=SNAPSHOT_MONTHS, forecast_lines=lines[customer_id]
            )
            _replace_snapshot(customer_id, snapshot_month, plan["rows"])
        except Exception as exc:
            logger.warning("Could not save the sell-in plan of customer %s: %s", customer_id, exc)
            failed.append(customer_id)
            continue
        saved.append(customer_id)
    return {"snapshot_month": snapshot_month.isoformat(), "saved": saved, "failed": failed}


def take_snapshot_best_effort() -> None:
    # A refresh that succeeded must still be recorded and announced when the
    # snapshot can't be saved; the Previous line then just has no new month.
    try:
        take_snapshot()
    except Exception as exc:
        logger.warning("Could not save the sell-in plan snapshot: %s", exc)
