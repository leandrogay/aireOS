from datetime import date, datetime, timezone
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


# Pieces every kind of customer-level setting shares (DOH today; see
# doh.py). A new kind of setting gets its own module next to doh.py and
# reuses these rather than copying them.


# ============================================================
# Custom Exceptions
# ============================================================


class CustomerNotFoundError(Exception):
    pass


# ============================================================
# ENGINE
#
# Same process-wide pools as the other Cloud SQL services: reads
# use the autocommit engine, every write is one transaction.
# ============================================================


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return sql.connect_with_connector()


@lru_cache(maxsize=1)
def get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


def read_connection() -> Connection:
    return get_read_engine().connect()


# ============================================================
# SMALL HELPERS
# ============================================================


def iso(value: datetime | None) -> str | None:
    # TIMESTAMPTZ comes back timezone-aware, so the offset is kept.
    return value.isoformat() if value is not None else None


def this_month() -> date:
    # The UTC month (AGENTS.md: "today" is the UTC day), as its first day.
    return datetime.now(timezone.utc).date().replace(day=1)


def in_effect(rows: list[dict], target, month: date) -> dict[tuple, dict]:
    """
    The row in effect in `month` per target, for append-only settings tables
    whose versions say the month they apply from (promo_anchor_settings,
    migration 022): the latest effective_from on or before `month` (NULL =
    from the start), then the newest save. Rows need effective_from,
    updated_at and id.
    """

    latest: dict[tuple, dict] = {}
    for row in rows:
        starts = row["effective_from"] or date.min
        if starts > month:
            continue
        key = target(row)
        current = latest.get(key)
        if current is None or (starts, row["updated_at"], row["id"]) > (
            current["effective_from"] or date.min, current["updated_at"], current["id"]
        ):
            latest[key] = row
    return latest


def newest(rows: list[dict], target) -> dict[tuple, dict]:
    """
    The newest row per target, for append-only settings tables whose current
    value is the latest version (updated_at, then id): rows need both keys.
    """

    latest: dict[tuple, dict] = {}
    for row in rows:
        key = target(row)
        current = latest.get(key)
        if current is None or (row["updated_at"], row["id"]) > (current["updated_at"], current["id"]):
            latest[key] = row
    return latest


def lock_customer(conn: Connection, customer_id: int) -> None:
    """
    404 check for every settings write, and a lock on the customer's row
    until the transaction ends, so two writes for the same customer run one
    after the other (for DOH this is what stops an identical save racing
    into a duplicate version). NO KEY UPDATE does not block other tables'
    foreign-key checks against customers.
    """

    row = conn.execute(
        text(
            """
            SELECT
                customer_id

            FROM customers

            WHERE
                customer_id = :customer_id

            FOR NO KEY UPDATE
            """
        ),
        {"customer_id": customer_id},
    ).first()

    if row is None:
        raise CustomerNotFoundError(f"Customer {customer_id} does not exist.")
