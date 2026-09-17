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

    p.period_start,
    p.period_end,
    p.period_label,
    p.promo_type,
    p.promotion_mechanic,
    p.voucher,

    COALESCE(
        (
            SELECT json_agg(
                store
                ORDER BY
                    store.retailer,
                    store.store_name,
                    store.store_id
            )

            FROM (
                SELECT
                    s.store_id,
                    s.store_name,
                    s.store_code,
                    s.store_format,
                    r.retailer_id,
                    r.retailer_name AS retailer

                FROM promotion_stores pst

                JOIN stores s
                    ON s.store_id = pst.store_id

                JOIN retailers r
                    ON r.retailer_id = s.retailer_id

                WHERE
                    pst.promotion_id = p.promotion_id
            ) AS store
        ),
        '[]'::json
    ) AS stores,

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
"""


# ============================================================
# STORE HELPERS
#
# A promotion is decoupled from stores: promotions carries no
# store_id, and the set of stores it runs in lives in
# promotion_stores. Each store ref is resolved through the
# catalog get_or_create seams so the row exists before the
# link is written.
# ============================================================


_INSERT_PROMOTION_STORE = text(
    """
    INSERT INTO promotion_stores (
        promotion_id,
        store_id
    )
    VALUES (
        :promotion_id,
        :store_id
    )

    ON CONFLICT (
        promotion_id,
        store_id
    )
    DO NOTHING
    """
)


def _resolve_store_ids(
    conn: Connection,
    store_refs: list,
) -> list[int]:
    store_ids: list[int] = []
    seen: set[int] = set()

    for ref in store_refs:
        retailer_id = get_or_create_retailer(
            conn,
            ref.retailer,
        )

        store_id = get_or_create_store(
            conn,
            retailer_id,
            ref.store_name,
            ref.store_code,
            ref.store_format,
        )

        if store_id in seen:
            continue
        seen.add(store_id)
        store_ids.append(store_id)

    return store_ids


def _add_stores_to_promotion(
    conn: Connection,
    promotion_id: int,
    store_refs: list,
) -> None:
    store_ids = _resolve_store_ids(conn, store_refs)

    if not store_ids:
        raise ValueError(
            "A promotion must be linked to at least one store."
        )

    conn.execute(
        _INSERT_PROMOTION_STORE,
        [
            {
                "promotion_id": promotion_id,
                "store_id": store_id,
            }
            for store_id in store_ids
        ],
    )


# ============================================================
# SKU HELPERS
#
# `skus` is catalog master data. Promotion writes must not
# insert or rewrite those rows. A ticked range is resolved to
# the product SKUs already stored for that sku_range, then
# linked through promotion_skus only.
# ============================================================


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


def _catalog_skus_for_items(
    conn: Connection,
    sku_items: list,
) -> list[str]:
    # Prefer sku_range so a form tick like "Aire Adult Diaper
    # Pants" maps to every catalog product in that range, not
    # to a fake skus row whose pk equals the range name.
    codes: list[str] = []
    seen: set[str] = set()

    for item in sku_items:
        range_name = (item.sku_range or "").strip() or None
        sku_code = (item.sku or "").strip() or None
        found: list[str] = []

        if range_name:
            found = list(
                conn.execute(
                    text(
                        """
                        SELECT sku

                        FROM skus

                        WHERE
                            sku_range = :sku_range
                            AND sku IS DISTINCT FROM :sku_range

                        ORDER BY
                            sku
                        """
                    ),
                    {
                        "sku_range": range_name,
                    },
                ).scalars().all()
            )

        if not found and sku_code:
            existing = conn.execute(
                text(
                    """
                    SELECT sku

                    FROM skus

                    WHERE
                        sku = :sku
                    """
                ),
                {
                    "sku": sku_code,
                },
            ).scalar()

            if existing:
                found = [existing]

        for sku in found:
            if sku in seen:
                continue
            seen.add(sku)
            codes.append(sku)

    return codes


def _add_skus_to_promotion(
    conn: Connection,
    promotion_id: int,
    sku_items: list,
) -> None:
    if not sku_items:
        return

    codes = _catalog_skus_for_items(conn, sku_items)

    if not codes:
        raise ValueError(
            "No catalog SKUs match the selected SKU ranges."
        )

    conn.execute(
        _UPSERT_PROMOTION_SKU,
        [
            {
                "promotion_id": promotion_id,
                "sku": sku,
                "quantity_units": None,
            }
            for sku in codes
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
        promotion_id = conn.execute(
            text(
                """
                INSERT INTO promotions (
                    period_start,
                    period_end,
                    period_label,
                    promo_type,
                    promotion_mechanic,
                    voucher
                )
                VALUES (
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
                "period_start": promotion.period_start,
                "period_end": promotion.period_end,
                "period_label": promotion.period_label,
                "promo_type": promotion.promo_type,
                "promotion_mechanic": promotion.promotion_mechanic,
                "voucher": promotion.voucher,
            },
        ).scalar_one()

        _add_stores_to_promotion(
            conn,
            promotion_id,
            promotion.stores,
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

        # updated_at is set by the trg_promotions_updated_at
        # trigger, so it is not listed here.
        conn.execute(
            text(
                """
                UPDATE promotions

                SET
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
                "period_start": promotion.period_start,
                "period_end": promotion.period_end,
                "period_label": promotion.period_label,
                "promo_type": promotion.promo_type,
                "promotion_mechanic": promotion.promotion_mechanic,
                "voucher": promotion.voucher,
            },
        )

        # Replace the store links with the set supplied by the
        # request. Rows in `stores` and `retailers` are master
        # data and are deliberately left in place.
        conn.execute(
            text(
                """
                DELETE FROM promotion_stores

                WHERE
                    promotion_id = :promotion_id
                """
            ),
            {
                "promotion_id": promotion_id,
            },
        )

        _add_stores_to_promotion(
            conn,
            promotion_id,
            promotion.stores,
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

        # promotion_skus has ON DELETE CASCADE, but the link
        # deletes are kept explicit so the behaviour does not
        # depend on the constraints being present.
        conn.execute(
            text(
                """
                DELETE FROM promotion_stores

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