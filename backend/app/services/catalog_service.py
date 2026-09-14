from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


# ============================================================
# Custom Exceptions
# ============================================================


class RetailerNotFoundError(Exception):
    pass


class RetailerHasStoresError(Exception):
    pass


class StoreHasPromotionsError(Exception):
    pass


# ============================================================
# ENGINE
#
# sql.connect_with_connector() hands back a process-wide
# singleton, so this wrapper reuses the same pool as the other
# services instead of opening a second one.
# ============================================================


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    return sql.connect_with_connector()


# ============================================================
# RETAILER HELPERS
#
# get_or_create_retailer is the seam promotion_service uses:
# a promotion write names its retailer as free text, so the
# row has to be created on demand inside that transaction.
# ============================================================


def get_or_create_retailer(
    conn: Connection,
    retailer_name: str,
) -> int:
    # The DO UPDATE is a deliberate no-op: it exists only so
    # that RETURNING yields a row on conflict. DO NOTHING
    # would return nothing at all.
    query = text(
        """
        INSERT INTO retailers (
            retailer_name
        )
        VALUES (
            :retailer_name
        )

        ON CONFLICT (retailer_name)
        DO UPDATE SET
            retailer_name = retailers.retailer_name

        RETURNING retailer_id
        """
    )

    return conn.execute(
        query,
        {
            "retailer_name": retailer_name,
        },
    ).scalar_one()


def _fetch_retailer(
    conn: Connection,
    retailer_id: int,
) -> dict | None:
    query = text(
        """
        SELECT
            r.retailer_id,
            r.retailer_name,
            COUNT(s.store_id) AS store_count

        FROM retailers r

        LEFT JOIN stores s
            ON s.retailer_id = r.retailer_id

        WHERE
            r.retailer_id = :retailer_id

        GROUP BY
            r.retailer_id,
            r.retailer_name
        """
    )

    result = conn.execute(
        query,
        {
            "retailer_id": retailer_id,
        },
    ).mappings().first()

    if result is None:
        return None

    return dict(result)


# ============================================================
# RETAILER CREATE
# ============================================================


def create_retailer(
    retailer,
) -> dict:
    with _get_engine().begin() as conn:
        retailer_id = conn.execute(
            text(
                """
                INSERT INTO retailers (
                    retailer_name
                )
                VALUES (
                    :retailer_name
                )

                RETURNING retailer_id
                """
            ),
            {
                "retailer_name": retailer.retailer_name,
            },
        ).scalar_one()

        return _fetch_retailer(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER READ ALL
# ============================================================


def get_retailers() -> list[dict]:
    query = text(
        """
        SELECT
            r.retailer_id,
            r.retailer_name,
            COUNT(s.store_id) AS store_count

        FROM retailers r

        LEFT JOIN stores s
            ON s.retailer_id = r.retailer_id

        GROUP BY
            r.retailer_id,
            r.retailer_name

        ORDER BY
            r.retailer_name ASC
        """
    )

    with _get_engine().connect() as conn:
        results = conn.execute(
            query
        ).mappings().all()

    return [
        dict(row)
        for row in results
    ]


# ============================================================
# RETAILER READ ONE
# ============================================================


def get_retailer(
    retailer_id: int,
) -> dict | None:
    with _get_engine().connect() as conn:
        return _fetch_retailer(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER UPDATE
# ============================================================


def update_retailer(
    retailer_id: int,
    retailer,
) -> dict | None:
    with _get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE retailers

                SET
                    retailer_name = :retailer_name

                WHERE
                    retailer_id = :retailer_id

                RETURNING retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
                "retailer_name": retailer.retailer_name,
            },
        ).scalar()

        if result is None:
            return None

        return _fetch_retailer(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER DELETE
# ============================================================


def delete_retailer(
    retailer_id: int,
) -> bool:
    with _get_engine().begin() as conn:
        retailer_exists = conn.execute(
            text(
                """
                SELECT 1

                FROM retailers

                WHERE retailer_id = :retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
            },
        ).first()

        if retailer_exists is None:
            return False

        has_stores = conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1

                    FROM stores

                    WHERE retailer_id = :retailer_id
                )
                """
            ),
            {
                "retailer_id": retailer_id,
            },
        ).scalar_one()

        if has_stores:
            raise RetailerHasStoresError(
                "Retailer cannot be deleted because "
                "it still has stores."
            )

        conn.execute(
            text(
                """
                DELETE FROM retailers

                WHERE retailer_id = :retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
            },
        )

        return True


# ============================================================
# STORE HELPERS
#
# get_or_create_store is the matching seam for promotion
# writes; the rest stay private to this module.
# ============================================================


def _ensure_retailer_exists(
    conn: Connection,
    retailer_id: int,
) -> None:
    retailer = conn.execute(
        text(
            """
            SELECT 1

            FROM retailers

            WHERE retailer_id = :retailer_id
            """
        ),
        {
            "retailer_id": retailer_id,
        },
    ).first()

    if retailer is None:
        raise RetailerNotFoundError(
            f"Retailer {retailer_id} does not exist."
        )


def get_or_create_store(
    conn: Connection,
    retailer_id: int,
    store_name: str,
    store_code: str,
    store_format: str | None = None,
) -> int:
    # On conflict the existing store_name is preserved: a
    # promotion write must not silently rename a store that
    # other promotions also point at.
    #
    # store_format uses COALESCE so an incoming value can
    # fill a gap on a store that has none, but can never
    # overwrite a format already recorded. Use the /stores
    # endpoints to change either field deliberately.
    query = text(
        """
        INSERT INTO stores (
            retailer_id,
            store_code,
            store_name,
            store_format
        )
        VALUES (
            :retailer_id,
            :store_code,
            :store_name,
            :store_format
        )

        ON CONFLICT (
            retailer_id,
            store_code
        )
        DO UPDATE SET
            store_name = stores.store_name,
            store_format = COALESCE(
                stores.store_format,
                EXCLUDED.store_format
            )

        RETURNING store_id
        """
    )

    return conn.execute(
        query,
        {
            "retailer_id": retailer_id,
            "store_code": store_code,
            "store_name": store_name,
            "store_format": store_format,
        },
    ).scalar_one()


def _fetch_store(
    conn: Connection,
    store_id: int,
) -> dict | None:
    query = text(
        """
        SELECT
            s.store_id,
            s.store_code,
            s.store_name,
            s.store_format,

            r.retailer_id,
            r.retailer_name,

            COUNT(pst.promotion_id) AS promotion_count

        FROM stores s

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        LEFT JOIN promotion_stores pst
            ON pst.store_id = s.store_id

        WHERE
            s.store_id = :store_id

        GROUP BY
            s.store_id,
            s.store_code,
            s.store_name,
            s.store_format,
            r.retailer_id,
            r.retailer_name
        """
    )

    result = conn.execute(
        query,
        {
            "store_id": store_id,
        },
    ).mappings().first()

    if result is None:
        return None

    return dict(result)


# ============================================================
# STORE CREATE
# ============================================================


def create_store(
    store,
) -> dict:
    with _get_engine().begin() as conn:
        _ensure_retailer_exists(
            conn,
            store.retailer_id,
        )

        store_id = conn.execute(
            text(
                """
                INSERT INTO stores (
                    retailer_id,
                    store_code,
                    store_name,
                    store_format
                )
                VALUES (
                    :retailer_id,
                    :store_code,
                    :store_name,
                    :store_format
                )

                RETURNING store_id
                """
            ),
            {
                "retailer_id": store.retailer_id,
                "store_code": store.store_code,
                "store_name": store.store_name,
                "store_format": store.store_format,
            },
        ).scalar_one()

        return _fetch_store(
            conn,
            store_id,
        )


# ============================================================
# STORE READ ALL
# ============================================================


def get_stores(
    retailer_id: int | None = None,
) -> list[dict]:
    # The CAST is required: without it the driver cannot infer
    # a type for the parameter when it is NULL.
    query = text(
        """
        SELECT
            s.store_id,
            s.store_code,
            s.store_name,
            s.store_format,

            r.retailer_id,
            r.retailer_name,

            COUNT(pst.promotion_id) AS promotion_count

        FROM stores s

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        LEFT JOIN promotion_stores pst
            ON pst.store_id = s.store_id

        WHERE
            (
                CAST(:retailer_id AS INTEGER) IS NULL
                OR s.retailer_id = CAST(:retailer_id AS INTEGER)
            )

        GROUP BY
            s.store_id,
            s.store_code,
            s.store_name,
            s.store_format,
            r.retailer_id,
            r.retailer_name

        ORDER BY
            r.retailer_name ASC,
            s.store_name ASC
        """
    )

    with _get_engine().connect() as conn:
        results = conn.execute(
            query,
            {
                "retailer_id": retailer_id,
            },
        ).mappings().all()

    return [
        dict(row)
        for row in results
    ]


# ============================================================
# STORE READ ONE
# ============================================================


def get_store(
    store_id: int,
) -> dict | None:
    with _get_engine().connect() as conn:
        return _fetch_store(
            conn,
            store_id,
        )


# ============================================================
# STORE UPDATE
# ============================================================


def update_store(
    store_id: int,
    store,
) -> dict | None:
    with _get_engine().begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT 1

                FROM stores

                WHERE store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
            },
        ).first()

        if existing is None:
            return None

        _ensure_retailer_exists(
            conn,
            store.retailer_id,
        )

        conn.execute(
            text(
                """
                UPDATE stores

                SET
                    retailer_id = :retailer_id,
                    store_code = :store_code,
                    store_name = :store_name,
                    store_format = :store_format

                WHERE
                    store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
                "retailer_id": store.retailer_id,
                "store_code": store.store_code,
                "store_name": store.store_name,
                "store_format": store.store_format,
            },
        )

        return _fetch_store(
            conn,
            store_id,
        )


# ============================================================
# STORE DELETE
# ============================================================


def delete_store(
    store_id: int,
) -> bool:
    with _get_engine().begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT 1

                FROM stores

                WHERE store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
            },
        ).first()

        if existing is None:
            return False

        has_promotions = conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1

                    FROM promotion_stores

                    WHERE store_id = :store_id
                )
                """
            ),
            {
                "store_id": store_id,
            },
        ).scalar_one()

        if has_promotions:
            raise StoreHasPromotionsError(
                "Store cannot be deleted because "
                "it has promotions."
            )

        conn.execute(
            text(
                """
                DELETE FROM stores

                WHERE store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
            },
        )

        return True



# ============================================================
# SKU READ DISTINCT RANGES
#
# sku_range is nullable on skus, so NULLs are filtered out
# rather than surfaced as a null option. Rows whose sku equals
# sku_range are leftover range-name inserts, not catalog
# products, so they are excluded.
# ============================================================


def get_sku_ranges() -> list[str]:
    query = text(
        """
        SELECT DISTINCT
            sku_range

        FROM skus

        WHERE
            sku_range IS NOT NULL
            AND sku IS DISTINCT FROM sku_range

        ORDER BY
            sku_range ASC
        """
    )

    with _get_engine().connect() as conn:
        results = conn.execute(
            query
        ).scalars().all()

    return list(results)
