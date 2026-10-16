from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


# Customers (customers table, e.g. "fairprice") and the retailers that
# belong to them (customer_retailers -> retailers, e.g.
# "fairprice_online"), for the Customers page. Retailer writes live in
# catalog_service; they call fetch_customer here to hand back the
# parent customer row.
#
# A customer or retailer that already has data cannot be renamed or
# deleted. Rows linked by id would follow a rename, but the dashboard
# and promotions find a customer's retailers by building
# "{customer}_online"/"{customer}_offline", uploads match retailers by
# name in get_or_create_retailers, and BigQuery forecast rows store
# customer_name as text -- all of those would silently lose the data.


# ============================================================
# Custom Exceptions
# ============================================================


class CustomerNameTakenError(Exception):
    pass


class CustomerInUseError(Exception):
    pass


class CustomerHasRetailersError(Exception):
    pass


# ============================================================
# ENGINE
#
# Same process-wide pools as the other Cloud SQL services: the
# list is a read on the autocommit engine, every write is one
# transaction.
# ============================================================


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    return sql.connect_with_connector()


@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


# ============================================================
# SHARED SQL FRAGMENTS
#
# A retailer is in use once it has a store: sell-out rows (FK to
# stores) and promotions (promotion_stores -> stores) both need one.
# A customer is in use when any of its retailers is, or it has
# inventory rows of its own. DOH settings are not checked yet: the
# customer <-> DOH link is still to be settled. json_agg returns NULL when there
# are no rows, hence the COALESCE to an empty array.
# ============================================================


_RETAILER_COLUMNS = """
    r.retailer_id,
    r.retailer_name,
    COUNT(s.store_id) AS store_count,
    COUNT(s.store_id) > 0 AS in_use
"""

_CUSTOMER_QUERY = f"""
    SELECT
        c.customer_id,
        c.customer_name,

        COALESCE(
            (
                SELECT json_agg(
                    retailer
                    ORDER BY retailer.retailer_name
                )

                FROM (
                    SELECT
                        {_RETAILER_COLUMNS}

                    FROM customer_retailers cr

                    JOIN retailers r
                        ON r.retailer_id = cr.retailer_id

                    LEFT JOIN stores s
                        ON s.retailer_id = r.retailer_id

                    WHERE
                        cr.customer_id = c.customer_id

                    GROUP BY
                        r.retailer_id,
                        r.retailer_name
                ) AS retailer
            ),
            CAST('[]' AS json)
        ) AS retailers,

        (
            EXISTS (
                SELECT 1

                FROM customer_retailers cr

                JOIN stores s
                    ON s.retailer_id = cr.retailer_id

                WHERE cr.customer_id = c.customer_id
            )
            OR EXISTS (
                SELECT 1 FROM inventory_metrics im
                WHERE im.customer_id = c.customer_id
            )
        ) AS in_use

    FROM customers c

    WHERE
        (
            CAST(:customer_id AS INTEGER) IS NULL
            OR c.customer_id = CAST(:customer_id AS INTEGER)
        )

    ORDER BY
        c.customer_name ASC
"""

_UNLINKED_RETAILERS_QUERY = f"""
    SELECT
        {_RETAILER_COLUMNS}

    FROM retailers r

    LEFT JOIN stores s
        ON s.retailer_id = r.retailer_id

    WHERE
        NOT EXISTS (
            SELECT 1

            FROM customer_retailers cr

            WHERE cr.retailer_id = r.retailer_id
        )

    GROUP BY
        r.retailer_id,
        r.retailer_name

    ORDER BY
        r.retailer_name ASC
"""


# ============================================================
# HELPERS
# ============================================================


def _fetch_customers(
    conn: Connection,
    customer_id: int | None = None,
) -> list[dict]:
    rows = conn.execute(
        text(_CUSTOMER_QUERY),
        {
            "customer_id": customer_id,
        },
    ).mappings().all()

    return [
        dict(row)
        for row in rows
    ]


def fetch_customer(
    conn: Connection,
    customer_id: int,
) -> dict | None:
    """One customer in the list_customers shape, inside the caller's transaction (None when missing)."""

    rows = _fetch_customers(conn, customer_id)
    return rows[0] if rows else None


def _ensure_customer_name_free(
    conn: Connection,
    customer_name: str,
    exclude_customer_id: int | None = None,
) -> None:
    # Names arrive as lowercase slugs (schemas.catalog.normalise_name);
    # lower() on the column also catches an older row stored in
    # another case. The unique constraint is still the backstop for
    # a race: the router maps its IntegrityError to the same 409.
    taken = conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1

                FROM customers

                WHERE
                    lower(customer_name) = lower(:customer_name)
                    AND customer_id IS DISTINCT FROM CAST(:exclude_id AS INTEGER)
            )
            """
        ),
        {
            "customer_name": customer_name,
            "exclude_id": exclude_customer_id,
        },
    ).scalar_one()

    if taken:
        raise CustomerNameTakenError(
            f'A customer named "{customer_name}" already exists.'
        )


# ============================================================
# CUSTOMER READ ALL
# ============================================================


def list_customers() -> dict:
    """
    Every customer with its retailers and in-use flags, plus the
    retailers no customer owns yet (promotions and uploads create
    retailers by name through get_or_create_retailers, without a
    customer) so staff can link them.
    """

    with _get_read_engine().connect() as conn:
        customers = _fetch_customers(conn)
        unlinked = conn.execute(
            text(_UNLINKED_RETAILERS_QUERY)
        ).mappings().all()

    return {
        "customers": customers,
        "unlinked_retailers": [
            dict(row)
            for row in unlinked
        ],
    }


# ============================================================
# CUSTOMER CREATE
# ============================================================


def create_customer(
    customer,
) -> dict:
    with _get_engine().begin() as conn:
        _ensure_customer_name_free(
            conn,
            customer.customer_name,
        )

        customer_id = conn.execute(
            text(
                """
                INSERT INTO customers (
                    customer_name
                )
                VALUES (
                    :customer_name
                )

                RETURNING customer_id
                """
            ),
            {
                "customer_name": customer.customer_name,
            },
        ).scalar_one()

        return fetch_customer(
            conn,
            customer_id,
        )


# ============================================================
# CUSTOMER UPDATE
# ============================================================


def update_customer(
    customer_id: int,
    customer,
) -> dict | None:
    with _get_engine().begin() as conn:
        current = fetch_customer(
            conn,
            customer_id,
        )

        if current is None:
            return None

        if current["in_use"]:
            raise CustomerInUseError(
                f'"{current["customer_name"]}" already has sales '
                "or inventory data, so it can't be renamed."
            )

        _ensure_customer_name_free(
            conn,
            customer.customer_name,
            exclude_customer_id=customer_id,
        )

        conn.execute(
            text(
                """
                UPDATE customers

                SET
                    customer_name = :customer_name

                WHERE
                    customer_id = :customer_id
                """
            ),
            {
                "customer_id": customer_id,
                "customer_name": customer.customer_name,
            },
        )

        return fetch_customer(
            conn,
            customer_id,
        )


# ============================================================
# CUSTOMER DELETE
# ============================================================


def delete_customer(
    customer_id: int,
) -> bool:
    with _get_engine().begin() as conn:
        current = fetch_customer(
            conn,
            customer_id,
        )

        if current is None:
            return False

        if current["in_use"]:
            raise CustomerInUseError(
                f'"{current["customer_name"]}" already has sales '
                "or inventory data, so it can't be deleted."
            )

        if current["retailers"]:
            raise CustomerHasRetailersError(
                f'Delete the retailers under "{current["customer_name"]}" first.'
            )

        conn.execute(
            text(
                """
                DELETE FROM customers

                WHERE customer_id = :customer_id
                """
            ),
            {
                "customer_id": customer_id,
            },
        )

        return True
