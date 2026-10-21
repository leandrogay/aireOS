"""
A single shared notification feed -- no per-user accounts exist anywhere in
this app, so read state is shared across everyone rather than per-account.
Two kinds of alert write here: low-stock/stockout (from inventory_service,
when a SKU written via Create/Edit/Upload drops below its DOH threshold) and
forecast pipeline success/failure (from scripts/refresh_forecast.py).

`payload` is structured JSON, not pre-rendered text, so the wording staff see
lives in the frontend and can change without a migration. This module only
knows how to store and query notifications; it has no DOH/forecast knowledge
of its own (that stays in inventory_service / refresh_forecast.py, which call
`insert` with data they have already worked out).
"""

import json
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql

LOW_STOCK = "low_stock"
FORECAST_SUCCESS = "forecast_success"
FORECAST_FAILURE = "forecast_failure"

# SKU count at which one batch of low-stock alerts becomes a single
# consolidated notification instead of one per SKU.
CONSOLIDATE_AT = 5


# ============================================================
# ENGINE
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
# READS
# ============================================================


def _payload(value) -> dict:
    # pg8000 decodes jsonb to a dict already; tolerate a raw string too.
    return json.loads(value) if isinstance(value, str) else value


def _row_to_dict(row) -> dict:
    notification_id, notification_type, payload, created_at, read_at = row
    return {
        "notification_id": notification_id,
        "notification_type": notification_type,
        "payload": _payload(payload),
        "created_at": created_at.isoformat() if created_at else None,
        "read_at": read_at.isoformat() if read_at else None,
    }


def list_notifications(unread_only: bool = False, limit: int = 50) -> list[dict]:
    """Newest first."""

    where = "WHERE read_at IS NULL" if unread_only else ""
    with _read_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT notification_id, notification_type, payload, created_at, read_at
                FROM notifications
                {where}
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).all()
    return [_row_to_dict(row) for row in rows]


def unread_count() -> int:
    with _read_connection() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL")
        ).scalar_one()


def already_alerted_skus(conn: Connection, customer_id: int) -> set[str]:
    """
    SKUs already covered by an unread low_stock notification for this
    customer, individually or inside a consolidated one -- so a write never
    re-alerts a SKU that is already flagged and still unread.
    """

    rows = conn.execute(
        text(
            """
            SELECT DISTINCT unnest(skus)
            FROM notifications
            WHERE notification_type = :notification_type
              AND customer_id = :customer_id
              AND read_at IS NULL
            """
        ),
        {"notification_type": LOW_STOCK, "customer_id": customer_id},
    ).all()
    return {row[0] for row in rows}


# ============================================================
# WRITES
# ============================================================


def mark_read(notification_ids: list[int]) -> int:
    """Marks the given notifications read; already-read ones are left alone.
    Returns how many were newly marked."""

    if not notification_ids:
        return 0
    with _get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE notifications
                SET read_at = CURRENT_TIMESTAMP
                WHERE notification_id = ANY(CAST(:ids AS bigint[]))
                  AND read_at IS NULL
                """
            ),
            {"ids": notification_ids},
        )
        return result.rowcount


def _insert(
    conn: Connection,
    notification_type: str,
    payload: dict,
    customer_id: int | None,
    skus: list[str] | None,
) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO notifications (notification_type, customer_id, skus, payload)
            VALUES (:notification_type, :customer_id, :skus, CAST(:payload AS jsonb))
            RETURNING notification_id
            """
        ),
        {
            "notification_type": notification_type,
            "customer_id": customer_id,
            "skus": skus,
            "payload": json.dumps(payload, default=str),
        },
    ).first()
    return row[0]


def insert(
    notification_type: str,
    payload: dict,
    *,
    customer_id: int | None = None,
    skus: list[str] | None = None,
    conn: Connection | None = None,
) -> int:
    """
    Writes one notification. Pass `conn` to include it in a caller's own
    transaction (inventory writes, so a notification never outlives a write
    that then rolls back); omit it to open and commit a transaction of this
    call's own (the standalone forecast script has no transaction open already).
    """

    if conn is not None:
        return _insert(conn, notification_type, payload, customer_id, skus)
    with _get_engine().begin() as new_conn:
        return _insert(new_conn, notification_type, payload, customer_id, skus)
