"""Record promotion-calc recalculation requests atomically and wake the delayed worker."""

import logging
import time

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app import config
from app.services import forecast_refresh_events


# Saves record a request in their own transaction, so a recalculation is
# never lost; the worker (promo_recalc.process_pending) claims every pending
# request at once. Kept apart from promo_recalc.py, which reads sell-out, so
# the sell-out and promotion services can import this without a cycle.
#
# Requests are only recorded while PROMO_RECALC_ENABLED is on (after
# migration 023 has run), so a save never fails on a missing table.

logger = logging.getLogger("uvicorn.error")

# A save wakes the worker after this long, and every save inside one window
# shares that task (the key is the window), so a batch of uploads or edits is
# worked out once.
QUIET_SECONDS = 300

REASONS = {
    "promotion_change", "sales_upload", "sales_rollback", "anchor_change",
    "mechanic_change", "manual", "retry",
}


def enabled() -> bool:
    return config.PROMO_RECALC_ENABLED.strip().lower() in {"1", "true", "yes", "on"}


def _check(reason: str) -> None:
    if reason not in REASONS:
        raise ValueError(f"Invalid promo recalculation reason: {reason}")


def record_customers(
    conn: Connection,
    reason: str,
    customer_ids: list[int] | None,
    source: str | None = None,
    force: bool = False,
) -> bool:
    """Queue the given customers (None = every customer). `force` records even while disabled (Recalculate)."""

    _check(reason)
    if not (force or enabled()):
        return False
    for customer_id in customer_ids if customer_ids is not None else [None]:
        conn.execute(
            text(
                """
                INSERT INTO promo_recalc_requests (customer_id, reason, source)
                VALUES (CAST(:customer_id AS integer), :reason, :source)
                """
            ),
            {"customer_id": customer_id, "reason": reason, "source": source},
        )
    return True


def record_promotion(conn: Connection, promotion_id: int) -> bool:
    """Queue every customer the promotion's stores belong to, as linked right now in this transaction."""

    if not enabled():
        return False
    conn.execute(
        text(
            """
            INSERT INTO promo_recalc_requests (customer_id, reason, source)

            SELECT DISTINCT
                cr.customer_id,
                'promotion_change',
                'promotion:' || CAST(:promotion_id AS text)

            FROM promotion_stores pst
            JOIN stores s
                ON s.store_id = pst.store_id
            JOIN customer_retailers cr
                ON cr.retailer_id = s.retailer_id

            WHERE
                pst.promotion_id = :promotion_id
            """
        ),
        {"promotion_id": promotion_id},
    )
    return True


def record_retailers(conn: Connection, reason: str, retailer_ids: list[int], source: str | None = None) -> bool:
    """Queue the customers that own these retailers (a sell-out load)."""

    _check(reason)
    if not enabled() or not retailer_ids:
        return False
    conn.execute(
        text(
            """
            INSERT INTO promo_recalc_requests (customer_id, reason, source)

            SELECT DISTINCT
                customer_id,
                :reason,
                :source

            FROM customer_retailers

            WHERE
                retailer_id = ANY(:retailer_ids)
            """
        ),
        {"reason": reason, "source": source, "retailer_ids": sorted(set(retailer_ids))},
    )
    return True


def enqueue_best_effort(recorded: bool) -> None:
    """After the save commits: wake the worker. A saved change stays saved if this fails."""

    if not recorded or not config.PROMO_RECALC_HANDLER_URL:
        return
    window = int(time.time() // QUIET_SECONDS)
    try:
        forecast_refresh_events.enqueue_check(
            key=f"promo-recalc-{window}",
            delay_seconds=QUIET_SECONDS,
            url=config.PROMO_RECALC_HANDLER_URL,
        )
    except Exception as exc:
        logger.warning("Promo recalculation was recorded but not queued: %s", exc)
