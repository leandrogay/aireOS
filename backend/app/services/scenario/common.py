from datetime import datetime
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


# Pieces every kind of Scenario builder item shares (building blocks today;
# see building_blocks.py). Draft promotions get their own module next to it
# and reuse these rather than copying them.


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
# CUSTOMERS
# ============================================================

# Both kinds of item can cover several customers (customer_ids, migration 022).
_ITEM_TABLES = ("scenario_building_blocks", "scenario_promotions")


def remove_customer(conn: Connection, customer_id: int) -> None:
    """
    Take a customer that is being deleted out of every Scenario builder item,
    in the deleting transaction. A list has no foreign key, so this does what
    ON DELETE CASCADE does for customer_id: an item that named only this
    customer is deleted; one that named others too keeps them.
    """

    for table in _ITEM_TABLES:
        # Table names are this module's own constants, never user input.
        conn.execute(
            text(f"DELETE FROM {table} WHERE customer_ids = ARRAY[CAST(:customer_id AS INTEGER)]"),
            {"customer_id": customer_id},
        )
        conn.execute(
            text(
                f"""
                UPDATE {table}

                SET customer_ids = array_remove(customer_ids, CAST(:customer_id AS INTEGER))

                WHERE CAST(:customer_id AS INTEGER) = ANY(customer_ids)
                """
            ),
            {"customer_id": customer_id},
        )


# ============================================================
# SMALL HELPERS
# ============================================================


def iso(value: datetime | None) -> str | None:
    # TIMESTAMPTZ comes back timezone-aware, so the offset is kept.
    return value.isoformat() if value is not None else None
