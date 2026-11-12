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
    customer is deleted; one that named others too keeps them, and its
    switched-off pairs for this customer are dropped.
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
        # Its switched-off pairs (excluded_pairs, migration 023) go too.
        conn.execute(
            text(
                f"""
                UPDATE {table}

                SET excluded_pairs = COALESCE(
                    (
                        SELECT jsonb_agg(pair)
                        FROM jsonb_array_elements(excluded_pairs) AS pair
                        WHERE (pair ->> 'customer_id')::INTEGER <> CAST(:customer_id AS INTEGER)
                    ),
                    '[]'::jsonb
                )

                WHERE excluded_pairs @> jsonb_build_array(jsonb_build_object('customer_id', CAST(:customer_id AS INTEGER)))
                """
            ),
            {"customer_id": customer_id},
        )


def customer_names_select(alias: str) -> str:
    """SELECT fragment naming an item's customer_ids back, by name; empty for NULL (every customer)."""

    return f"""
        ARRAY(
            SELECT customer.customer_name
            FROM customers AS customer
            WHERE customer.customer_id = ANY({alias}.customer_ids)
            ORDER BY customer.customer_name
        ) AS customer_names"""


def excluded_pairs_select(alias: str) -> str:
    """SELECT fragment naming an item's switched-off pairs back; a deleted customer's are gone."""

    return f"""
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object('customer_name', customer.customer_name, 'sku_range', pair ->> 'sku_range')
                    ORDER BY customer.customer_name, pair ->> 'sku_range'
                )
                FROM jsonb_array_elements({alias}.excluded_pairs) AS pair
                JOIN customers AS customer
                    ON customer.customer_id = (pair ->> 'customer_id')::INTEGER
            ),
            '[]'::jsonb
        ) AS excluded_pairs"""


# ============================================================
# SMALL HELPERS
# ============================================================


def iso(value: datetime | None) -> str | None:
    # TIMESTAMPTZ comes back timezone-aware, so the offset is kept.
    return value.isoformat() if value is not None else None
