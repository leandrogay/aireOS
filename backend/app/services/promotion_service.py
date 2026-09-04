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
# An Engine owns a connection pool. Building one per request
# leaks pools and will exhaust the Cloud SQL connection limit
# under load, so it is created once and reused.
# ============================================================


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    return sql.connect_with_connector()


# ============================================================
# DATABASE HEALTH
# ============================================================


def check_db_connection() -> int:
    with _get_engine().connect() as conn:
        return conn.execute(
            text("SELECT 1")
        ).scalar_one()


# ============================================================
# SHARED SQL FRAGMENTS
# ============================================================

# ARRAY(subquery) returns an empty array when there are no
# rows, never NULL, so COALESCE is not needed here.
_PROMOTION_COLUMNS = """
    p.promotion_id,

    r.retailer_id,
    r.retailer_name AS retailer,

    s.store_id,
    s.store_name,
    s.store_code,

    p.period_start,
    p.period_end,
    p.period_label,
    p.promo_type,
    p.promotion_mechanic,
    p.voucher,

    ARRAY(
        SELECT ps.sku

        FROM promotion_skus ps

        WHERE
            ps.promotion_id = p.promotion_id

        ORDER BY
            ps.sku
    ) AS skus,

    p.created_at,
    p.updated_at
"""

_PROMOTION_JOINS = """
    FROM promotions p

    JOIN stores s
        ON s.store_id = p.store_id

    JOIN retailers r
        ON r.retailer_id = s.retailer_id
"""


# ============================================================
# INTERNAL RETAILER HELPERS
# ============================================================


def _get_or_create_retailer(
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
# INTERNAL STORE HELPERS
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


def _get_or_create_store(
    conn: Connection,
    retailer_id: int,
    store_name: str,
    store_code: str,
) -> int:
    # On conflict the existing store_name is preserved. A
    # promotion write must not silently rename a store that
    # other promotions also point at; use the /stores
    # endpoints to rename deliberately.
    query = text(
        """
        INSERT INTO stores (
            retailer_id,
            store_code,
            store_name
        )
        VALUES (
            :retailer_id,
            :store_code,
            :store_name
        )

        ON CONFLICT (
            retailer_id,
            store_code
        )
        DO UPDATE SET
            store_name = stores.store_name

        RETURNING store_id
        """
    )

    return conn.execute(
        query,
        {
            "retailer_id": retailer_id,
            "store_code": store_code,
            "store_name": store_name,
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

            r.retailer_id,
            r.retailer_name,

            COUNT(p.promotion_id) AS promotion_count

        FROM stores s

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        LEFT JOIN promotions p
            ON p.store_id = s.store_id

        WHERE
            s.store_id = :store_id

        GROUP BY
            s.store_id,
            s.store_code,
            s.store_name,
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
                    store_name
                )
                VALUES (
                    :retailer_id,
                    :store_code,
                    :store_name
                )

                RETURNING store_id
                """
            ),
            {
                "retailer_id": store.retailer_id,
                "store_code": store.store_code,
                "store_name": store.store_name,
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

            r.retailer_id,
            r.retailer_name,

            COUNT(p.promotion_id) AS promotion_count

        FROM stores s

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        LEFT JOIN promotions p
            ON p.store_id = s.store_id

        WHERE
            (
                CAST(:retailer_id AS INTEGER) IS NULL
                OR s.retailer_id = CAST(:retailer_id AS INTEGER)
            )

        GROUP BY
            s.store_id,
            s.store_code,
            s.store_name,
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
                    store_name = :store_name

                WHERE
                    store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
                "retailer_id": store.retailer_id,
                "store_code": store.store_code,
                "store_name": store.store_name,
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

                    FROM promotions

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
# SKU HELPERS
#
# `sku` is the natural primary key of the skus table, so
# there is no surrogate id and no lookup join needed.
# ============================================================


def _add_skus_to_promotion(
    conn: Connection,
    promotion_id: int,
    sku_codes: list[str],
) -> None:
    # Sorted so concurrent transactions lock rows in the same
    # order, which avoids deadlocks on overlapping SKU sets.
    cleaned_skus = sorted({
        sku.strip()
        for sku in sku_codes
        if sku and sku.strip()
    })

    if not cleaned_skus:
        return

    # Both statements are set-based: two round trips total,
    # regardless of how many SKUs are in the promotion.
    conn.execute(
        text(
            """
            INSERT INTO skus (sku)

            SELECT unnest(CAST(:skus AS VARCHAR[]))

            ON CONFLICT (sku)
            DO NOTHING
            """
        ),
        {
            "skus": cleaned_skus,
        },
    )

    conn.execute(
        text(
            """
            INSERT INTO promotion_skus (
                promotion_id,
                sku
            )

            SELECT
                :promotion_id,
                unnest(CAST(:skus AS VARCHAR[]))

            ON CONFLICT (
                promotion_id,
                sku
            )
            DO NOTHING
            """
        ),
        {
            "promotion_id": promotion_id,
            "skus": cleaned_skus,
        },
    )


# ============================================================
# PROMOTION FETCH HELPER
# ============================================================


def _fetch_promotion(
    conn: Connection,
    promotion_id: int,
) -> dict | None:
    query = text(
        f"""
        SELECT
            {_PROMOTION_COLUMNS}

        {_PROMOTION_JOINS}

        WHERE
            p.promotion_id = :promotion_id
        """
    )

    result = conn.execute(
        query,
        {
            "promotion_id": promotion_id,
        },
    ).mappings().first()

    if result is None:
        return None

    return dict(result)


# ============================================================
# PROMOTION CREATE
# ============================================================


def create_promotion(
    promotion,
) -> dict:
    with _get_engine().begin() as conn:
        retailer_id = _get_or_create_retailer(
            conn,
            promotion.retailer,
        )

        store_id = _get_or_create_store(
            conn,
            retailer_id,
            promotion.store_name,
            promotion.store_code,
        )

        promotion_id = conn.execute(
            text(
                """
                INSERT INTO promotions (
                    store_id,
                    period_start,
                    period_end,
                    period_label,
                    promo_type,
                    promotion_mechanic,
                    voucher
                )
                VALUES (
                    :store_id,
                    :period_start,
                    :period_end,
                    :period_label,
                    CAST(
                        :promo_type
                        AS promo_type_enum
                    ),
                    :promotion_mechanic,
                    :voucher
                )

                RETURNING promotion_id
                """
            ),
            {
                "store_id": store_id,
                "period_start": promotion.period_start,
                "period_end": promotion.period_end,
                "period_label": promotion.period_label,
                "promo_type": promotion.promo_type,
                "promotion_mechanic": promotion.promotion_mechanic,
                "voucher": promotion.voucher,
            },
        ).scalar_one()

        _add_skus_to_promotion(
            conn,
            promotion_id,
            promotion.skus,
        )

        return _fetch_promotion(
            conn,
            promotion_id,
        )


# ============================================================
# PROMOTION READ ALL
# ============================================================


def get_promotions() -> list[dict]:
    query = text(
        f"""
        SELECT
            {_PROMOTION_COLUMNS}

        {_PROMOTION_JOINS}

        ORDER BY
            p.period_start DESC,
            p.promotion_id DESC
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
# PROMOTION READ ONE
# ============================================================


def get_promotion(
    promotion_id: int,
) -> dict | None:
    with _get_engine().connect() as conn:
        return _fetch_promotion(
            conn,
            promotion_id,
        )


# ============================================================
# PROMOTION UPDATE
# ============================================================


def update_promotion(
    promotion_id: int,
    promotion,
) -> dict | None:
    with _get_engine().begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT 1

                FROM promotions

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        ).first()

        if existing is None:
            return None

        retailer_id = _get_or_create_retailer(
            conn,
            promotion.retailer,
        )

        store_id = _get_or_create_store(
            conn,
            retailer_id,
            promotion.store_name,
            promotion.store_code,
        )

        # updated_at is set by the trg_promotions_updated_at
        # trigger, so it is not listed here.
        conn.execute(
            text(
                """
                UPDATE promotions

                SET
                    store_id = :store_id,
                    period_start = :period_start,
                    period_end = :period_end,
                    period_label = :period_label,

                    promo_type = CAST(
                        :promo_type
                        AS promo_type_enum
                    ),

                    promotion_mechanic =
                        :promotion_mechanic,

                    voucher = :voucher

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
                "store_id": store_id,
                "period_start": promotion.period_start,
                "period_end": promotion.period_end,
                "period_label": promotion.period_label,
                "promo_type": promotion.promo_type,
                "promotion_mechanic": promotion.promotion_mechanic,
                "voucher": promotion.voucher,
            },
        )

        # Replace all current SKU mappings with
        # the new list supplied by the request.
        conn.execute(
            text(
                """
                DELETE FROM promotion_skus

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        )

        _add_skus_to_promotion(
            conn,
            promotion_id,
            promotion.skus,
        )

        return _fetch_promotion(
            conn,
            promotion_id,
        )


# ============================================================
# PROMOTION DELETE
# ============================================================


def delete_promotion(
    promotion_id: int,
) -> bool:
    with _get_engine().begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT 1

                FROM promotions

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        ).first()

        if existing is None:
            return False

        # promotion_skus has ON DELETE CASCADE, but this is
        # kept explicit so the behaviour does not depend on
        # the constraint being present.
        conn.execute(
            text(
                """
                DELETE FROM promotion_skus

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        )

        conn.execute(
            text(
                """
                DELETE FROM promotions

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        )

        return True