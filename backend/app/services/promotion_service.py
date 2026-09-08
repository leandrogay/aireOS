from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql
from app.services.catalog_service import (
    get_or_create_retailer,
    get_or_create_store,
)


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
#
# json_agg returns NULL when there are no rows, hence the
# COALESCE to an empty array.
# ============================================================

_PROMOTION_COLUMNS = """
    p.promotion_id,

    r.retailer_id,
    r.retailer_name AS retailer,

    s.store_id,
    s.store_name,
    s.store_code,
    s.store_format,

    p.period_start,
    p.period_end,
    p.period_label,
    p.promo_type,
    p.promotion_mechanic,
    p.voucher,

    COALESCE(
        (
            SELECT json_agg(line ORDER BY line.sku)

            FROM (
                SELECT
                    sk.sku,
                    sk.sku_range,
                    sk.product_name,
                    sk.size,
                    sk.brand,
                    sk.uom,
                    sk.pack_size,
                    sk.price,
                    ps.quantity_units

                FROM promotion_skus ps

                JOIN skus sk
                    ON sk.sku = ps.sku

                WHERE
                    ps.promotion_id = p.promotion_id
            ) AS line
        ),
        '[]'::json
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
# SKU HELPERS
#
# `sku` is the natural primary key of the skus table, so
# there is no surrogate id and no lookup join needed.
# ============================================================


_UPSERT_SKU = text(
    """
    INSERT INTO skus (
        sku,
        sku_range,
        product_name,
        size,
        brand,
        uom,
        pack_size,
        price
    )
    VALUES (
        :sku,
        :sku_range,
        :product_name,
        :size,
        :brand,
        :uom,
        :pack_size,
        :price
    )

    ON CONFLICT (sku)
    DO UPDATE SET
        sku_range        = COALESCE(EXCLUDED.sku_range,        skus.sku_range),
        product_name     = COALESCE(EXCLUDED.product_name,     skus.product_name),
        size             = COALESCE(EXCLUDED.size,             skus.size),
        brand            = COALESCE(EXCLUDED.brand,            skus.brand),
        uom              = COALESCE(EXCLUDED.uom,              skus.uom),
        pack_size        = COALESCE(EXCLUDED.pack_size,        skus.pack_size),
        price            = COALESCE(EXCLUDED.price,            skus.price)
    """
)


_UPSERT_PROMOTION_SKU = text(
    """
    INSERT INTO promotion_skus (
        promotion_id,
        sku,
        quantity_units
    )
    VALUES (
        :promotion_id,
        :sku,
        :quantity_units
    )

    ON CONFLICT (
        promotion_id,
        sku
    )
    DO UPDATE SET
        quantity_units = EXCLUDED.quantity_units
    """
)


def _add_skus_to_promotion(
    conn: Connection,
    promotion_id: int,
    sku_items: list,
) -> None:
    # De-duplicate by code, keeping the last occurrence, then
    # sort. Sorting makes concurrent transactions lock rows in
    # the same order, which avoids deadlocks on overlapping
    # SKU sets.
    by_code = {
        item.sku: item
        for item in sku_items
        if item.sku
    }

    if not by_code:
        return

    ordered = [
        by_code[code]
        for code in sorted(by_code)
    ]

    # A non-null incoming value updates the master record; a
    # null one leaves what is already there. This is the
    # opposite of the store policy, because SKU attributes are
    # scraped facts that should track the source, whereas a
    # store name is an identity a promotion must not rewrite.
    conn.execute(
        _UPSERT_SKU,
        [
            {
                "sku": item.sku,
                "sku_range": item.sku_range,
                "product_name": item.product_name,
                "size": item.size,
                "brand": item.brand,
                "uom": item.uom,
                "pack_size": item.pack_size,
                "price": item.price,
            }
            for item in ordered
        ],
    )

    conn.execute(
        _UPSERT_PROMOTION_SKU,
        [
            {
                "promotion_id": promotion_id,
                "sku": item.sku,
                "quantity_units": item.quantity_units,
            }
            for item in ordered
        ],
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
        retailer_id = get_or_create_retailer(
            conn,
            promotion.retailer,
        )

        store_id = get_or_create_store(
            conn,
            retailer_id,
            promotion.store_name,
            promotion.store_code,
            promotion.store_format,
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

        retailer_id = get_or_create_retailer(
            conn,
            promotion.retailer,
        )

        store_id = get_or_create_store(
            conn,
            retailer_id,
            promotion.store_name,
            promotion.store_code,
            promotion.store_format,
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

        # Replace all current SKU mappings with the new list
        # supplied by the request. Rows in `skus` are master
        # data and are deliberately left in place.
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