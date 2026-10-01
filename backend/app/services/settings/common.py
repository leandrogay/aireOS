from datetime import datetime
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
