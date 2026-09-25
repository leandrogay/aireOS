from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


# ============================================================
# ENGINE
#
# Read-only reference table, so this only ever needs the shared
# autocommit engine -- same pattern as catalog_service.py.
# ============================================================


@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


def _read_connection() -> Connection:
    return _get_read_engine().connect()


# ============================================================
# CUSTOMERS
#
# Fixed enumeration from the P&L workbook (see
# app/data/customers_schema.sql). Distinct from `retailers` in
# catalog_service.py: some of these customers (NHG, SingHealth,
# JurongHealth) are healthcare institutions, not retail store
# chains, so they don't belong in that table.
# ============================================================


def get_customer_names(customer_ids: list[int]) -> dict[int, str]:
    """Look up customer_name for a batch of customer_id values in one round trip."""

    ids = list(dict.fromkeys(customer_ids))

    if not ids:
        return {}

    query = text(
        """
        SELECT
            customer_id,
            customer_name

        FROM customers

        WHERE
            customer_id = ANY(CAST(:customer_ids AS integer[]))
        """
    )

    with _read_connection() as conn:
        rows = conn.execute(
            query,
            {
                "customer_ids": ids,
            },
        ).all()

    return {
        customer_id: customer_name
        for customer_id, customer_name in rows
    }


def list_customers() -> list[dict]:
    """Every known customer, for reference/debugging -- not on any hot path."""

    query = text(
        """
        SELECT
            customer_id,
            customer_name

        FROM customers

        ORDER BY
            customer_id
        """
    )

    with _read_connection() as conn:
        rows = conn.execute(query).mappings().all()

    return [dict(row) for row in rows]
