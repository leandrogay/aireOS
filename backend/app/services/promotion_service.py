from sqlalchemy import text
from sqlalchemy.engine import Connection

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
# DATABASE HEALTH
# ============================================================


def check_db_connection() -> int:
    engine = sql.connect_with_connector()

    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1")
        ).scalar_one()


# ============================================================
# INTERNAL RETAILER HELPERS
# ============================================================


def _get_or_create_retailer(
    conn: Connection,
    retailer_name: str,
) -> int:
    retailer_name = retailer_name.strip()

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
            retailer_name = EXCLUDED.retailer_name

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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
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
                "retailer_name": retailer.retailer_name.strip(),
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
    engine = sql.connect_with_connector()

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

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
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
                "retailer_name": retailer.retailer_name.strip(),
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
        retailer_exists = conn.execute(
            text(
                """
                SELECT retailer_id

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

        store_count = conn.execute(
            text(
                """
                SELECT COUNT(*)

                FROM stores

                WHERE retailer_id = :retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
            },
        ).scalar_one()

        if store_count > 0:
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
            SELECT retailer_id

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
    store_code: int,
) -> int:
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
            store_name = EXCLUDED.store_name

        RETURNING store_id
        """
    )

    return conn.execute(
        query,
        {
            "retailer_id": retailer_id,
            "store_code": store_code,
            "store_name": store_name.strip(),
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
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
                "store_name": store.store_name.strip(),
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
    engine = sql.connect_with_connector()

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
                :retailer_id IS NULL
                OR s.retailer_id = :retailer_id
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

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT store_id

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
                "store_name": store.store_name.strip(),
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT store_id

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

        promotion_count = conn.execute(
            text(
                """
                SELECT COUNT(*)

                FROM promotions

                WHERE store_id = :store_id
                """
            ),
            {
                "store_id": store_id,
            },
        ).scalar_one()

        if promotion_count > 0:
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
# ============================================================


def _get_or_create_sku(
    conn: Connection,
    sku_code: str,
) -> int:
    query = text(
        """
        INSERT INTO skus (
            sku_code
        )
        VALUES (
            :sku_code
        )

        ON CONFLICT (sku_code)
        DO UPDATE SET
            sku_code = EXCLUDED.sku_code

        RETURNING sku_id
        """
    )

    return conn.execute(
        query,
        {
            "sku_code": sku_code.strip(),
        },
    ).scalar_one()


def _add_skus_to_promotion(
    conn: Connection,
    promotion_id: int,
    sku_codes: list[str],
) -> None:
    cleaned_skus = {
        sku.strip()
        for sku in sku_codes
        if sku and sku.strip()
    }

    for sku_code in cleaned_skus:
        sku_id = _get_or_create_sku(
            conn,
            sku_code,
        )

        conn.execute(
            text(
                """
                INSERT INTO promotion_skus (
                    promotion_id,
                    sku_id
                )
                VALUES (
                    :promotion_id,
                    :sku_id
                )

                ON CONFLICT (
                    promotion_id,
                    sku_id
                )
                DO NOTHING
                """
            ),
            {
                "promotion_id": promotion_id,
                "sku_id": sku_id,
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
        """
        SELECT
            p.promotion_id,

            r.retailer_id,
            r.retailer_name AS retailer,

            s.store_id,
            s.store_name,
            s.store_code,

            p.week_start,
            p.week_end,
            p.period_label,
            p.promo_type,
            p.promotion_mechanic,
            p.voucher,

            COALESCE(
                ARRAY(
                    SELECT sku.sku_code

                    FROM promotion_skus ps

                    JOIN skus sku
                        ON sku.sku_id = ps.sku_id

                    WHERE
                        ps.promotion_id = p.promotion_id

                    ORDER BY
                        sku.sku_code
                ),
                ARRAY[]::VARCHAR[]
            ) AS skus,

            p.created_at,
            p.updated_at

        FROM promotions p

        JOIN stores s
            ON s.store_id = p.store_id

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
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
                    week_start,
                    week_end,
                    period_label,
                    promo_type,
                    promotion_mechanic,
                    voucher
                )
                VALUES (
                    :store_id,
                    :week_start,
                    :week_end,
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
                "week_start": promotion.week_start,
                "week_end": promotion.week_end,
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
    engine = sql.connect_with_connector()

    query = text(
        """
        SELECT
            p.promotion_id,

            r.retailer_id,
            r.retailer_name AS retailer,

            s.store_id,
            s.store_name,
            s.store_code,

            p.week_start,
            p.week_end,
            p.period_label,
            p.promo_type,
            p.promotion_mechanic,
            p.voucher,

            COALESCE(
                ARRAY(
                    SELECT sku.sku_code

                    FROM promotion_skus ps

                    JOIN skus sku
                        ON sku.sku_id = ps.sku_id

                    WHERE
                        ps.promotion_id = p.promotion_id

                    ORDER BY
                        sku.sku_code
                ),
                ARRAY[]::VARCHAR[]
            ) AS skus,

            p.created_at,
            p.updated_at

        FROM promotions p

        JOIN stores s
            ON s.store_id = p.store_id

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        ORDER BY
            p.week_start DESC,
            p.promotion_id DESC
        """
    )

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.connect() as conn:
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT promotion_id

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

        conn.execute(
            text(
                """
                UPDATE promotions

                SET
                    store_id = :store_id,
                    week_start = :week_start,
                    week_end = :week_end,
                    period_label = :period_label,

                    promo_type = CAST(
                        :promo_type
                        AS promo_type_enum
                    ),

                    promotion_mechanic =
                        :promotion_mechanic,

                    voucher = :voucher,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
                "store_id": store_id,
                "week_start": promotion.week_start,
                "week_end": promotion.week_end,
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
    engine = sql.connect_with_connector()

    with engine.begin() as conn:
        existing = conn.execute(
            text(
                """
                SELECT promotion_id

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

        # Explicitly delete mappings first.
        # This works even if ON DELETE CASCADE
        # is not configured.
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