import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from app.services import customer_service, sql
from app.services.settings.common import lock_customer


# ============================================================
# Custom Exceptions
# ============================================================


class RetailerNotFoundError(Exception):
    pass


class RetailerHasStoresError(Exception):
    pass


class RetailerNameTakenError(Exception):
    pass


class RetailerAlreadyLinkedError(Exception):
    pass


class StoreHasPromotionsError(Exception):
    pass


class SkuAlreadyExistsError(Exception):
    pass


class SkuHasPromotionsError(Exception):
    pass


class SkuPricePeriodConflictError(ValueError):
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


# Read paths run a single SELECT, so they gain nothing from a
# transaction. The autocommit engine skips the implicit BEGIN
# and the ROLLBACK on close: at ~220ms per round trip to Cloud
# SQL that is roughly 0.9s saved per request. Writes keep using
# _get_engine().begin().
@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


def _read_connection() -> Connection:
    return _get_read_engine().connect()


# ============================================================
# RETAILER HELPERS
#
# get_or_create_retailers is the seam promotion_service uses:
# a promotion write names its retailers as free text, so the
# rows have to be created on demand inside that transaction.
#
# It takes the whole batch at once. Every round trip to Cloud
# SQL costs ~200ms, so one UPSERT over an unnest()ed array is
# the difference between one round trip and one per store.
# ============================================================


def get_or_create_retailers(
    conn: Connection,
    retailer_names: list[str],
) -> dict[str, int]:
    """
    Upsert every distinct retailer name in one statement and
    return a name -> retailer_id map for the caller to join on.
    """

    names = list(dict.fromkeys(retailer_names))

    if not names:
        return {}

    # The DO UPDATE is a deliberate no-op: it exists only so
    # that RETURNING yields a row on conflict. DO NOTHING
    # would return nothing at all.
    query = text(
        """
        INSERT INTO retailers (
            retailer_name
        )
        SELECT
            name

        FROM unnest(
            CAST(:retailer_names AS text[])
        ) AS input(name)

        ON CONFLICT (retailer_name)
        DO UPDATE SET
            retailer_name = retailers.retailer_name

        RETURNING
            retailer_name,
            retailer_id
        """
    )

    rows = conn.execute(
        query,
        {
            "retailer_names": names,
        },
    ).all()

    return {
        retailer_name: retailer_id
        for retailer_name, retailer_id in rows
    }


def unowned_retailer_names(
    conn: Connection,
    retailer_names: list[str],
) -> list[str]:
    """
    The names that are not a retailer linked to a customer. A sell-out upload
    must write to a customer's retailers: one that creates its own would
    carry a spelling nobody reviewed, and the dashboard (which finds sales
    through the customer) would never show it.
    """

    names = list(dict.fromkeys(retailer_names))

    if not names:
        return []

    owned = set(
        conn.execute(
            text(
                """
                SELECT r.retailer_name

                FROM retailers r

                JOIN customer_retailers cr
                    ON cr.retailer_id = r.retailer_id

                WHERE r.retailer_name = ANY(CAST(:retailer_names AS text[]))
                """
            ),
            {
                "retailer_names": names,
            },
        ).scalars().all()
    )

    return [name for name in names if name not in owned]


def _fetch_retailer(
    conn: Connection,
    retailer_id: int,
) -> dict | None:
    # customer_id is NULL for a retailer no customer owns yet
    # (see customer_service.list_customers). A retailer with a
    # store is in use: sell-out and promotions both hang off stores.
    query = text(
        """
        SELECT
            r.retailer_id,
            r.retailer_name,
            cr.customer_id,
            COUNT(s.store_id) AS store_count,
            COUNT(s.store_id) > 0 AS in_use

        FROM retailers r

        LEFT JOIN customer_retailers cr
            ON cr.retailer_id = r.retailer_id

        LEFT JOIN stores s
            ON s.retailer_id = r.retailer_id

        WHERE
            r.retailer_id = :retailer_id

        GROUP BY
            r.retailer_id,
            r.retailer_name,
            cr.customer_id
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


def _retailer_result(
    conn: Connection,
    retailer_id: int,
) -> dict:
    # Every retailer write on the Customers page answers with the
    # retailer and its parent customer row, so the page can swap
    # the customer in place without refetching the whole list.
    retailer = _fetch_retailer(conn, retailer_id)
    customer_id = retailer["customer_id"]

    return {
        "retailer": retailer,
        "customer": (
            customer_service.fetch_customer(conn, customer_id)
            if customer_id is not None
            else None
        ),
    }


def _ensure_retailer_name_free(
    conn: Connection,
    retailer_name: str,
    exclude_retailer_id: int | None = None,
) -> None:
    # Same rule as customer names: case-insensitive, with the
    # unique constraint as the race backstop (IntegrityError -> 409).
    taken = conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1

                FROM retailers

                WHERE
                    lower(retailer_name) = lower(:retailer_name)
                    AND retailer_id IS DISTINCT FROM CAST(:exclude_id AS INTEGER)
            )
            """
        ),
        {
            "retailer_name": retailer_name,
            "exclude_id": exclude_retailer_id,
        },
    ).scalar_one()

    if taken:
        raise RetailerNameTakenError(
            f'A retailer named "{retailer_name}" already exists.'
        )


def _link_to_customer(
    conn: Connection,
    retailer_id: int,
    customer_id: int,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO customer_retailers (
                customer_id,
                retailer_id
            )
            VALUES (
                :customer_id,
                :retailer_id
            )
            """
        ),
        {
            "customer_id": customer_id,
            "retailer_id": retailer_id,
        },
    )


# ============================================================
# RETAILER CREATE
#
# A retailer is always created under a customer: the row and its
# customer_retailers link go in together.
# ============================================================


def create_retailer(
    retailer,
) -> dict:
    with _get_engine().begin() as conn:
        lock_customer(
            conn,
            retailer.customer_id,
        )

        _ensure_retailer_name_free(
            conn,
            retailer.retailer_name,
        )

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

        _link_to_customer(
            conn,
            retailer_id,
            retailer.customer_id,
        )

        return _retailer_result(
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

    with _read_connection() as conn:
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
    with _read_connection() as conn:
        return _fetch_retailer(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER UPDATE
#
# Only an unused retailer can be renamed (see customer_service for
# why a rename would lose data).
# ============================================================


def update_retailer(
    retailer_id: int,
    retailer,
) -> dict | None:
    with _get_engine().begin() as conn:
        current = _fetch_retailer(
            conn,
            retailer_id,
        )

        if current is None:
            return None

        if current["in_use"]:
            raise RetailerHasStoresError(
                f'"{current["retailer_name"]}" already has stores, '
                "sales or promotions, so it can't be renamed."
            )

        _ensure_retailer_name_free(
            conn,
            retailer.retailer_name,
            exclude_retailer_id=retailer_id,
        )

        conn.execute(
            text(
                """
                UPDATE retailers

                SET
                    retailer_name = :retailer_name

                WHERE
                    retailer_id = :retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
                "retailer_name": retailer.retailer_name,
            },
        )

        return _retailer_result(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER LINK
#
# For a retailer created without a customer (by a promotion or an
# upload). Moving a retailer that already has a customer is not
# offered: its sell-out would move to another customer's inventory.
# ============================================================


def link_retailer(
    retailer_id: int,
    customer_id: int,
) -> dict | None:
    with _get_engine().begin() as conn:
        lock_customer(
            conn,
            customer_id,
        )

        current = _fetch_retailer(
            conn,
            retailer_id,
        )

        if current is None:
            return None

        if current["customer_id"] is not None:
            raise RetailerAlreadyLinkedError(
                f'"{current["retailer_name"]}" already belongs to a customer.'
            )

        _link_to_customer(
            conn,
            retailer_id,
            customer_id,
        )

        return _retailer_result(
            conn,
            retailer_id,
        )


# ============================================================
# RETAILER DELETE
# ============================================================


def delete_retailer(
    retailer_id: int,
) -> dict | None:
    """
    Delete an unused retailer and its customer link. Returns the
    parent customer row (None for an unlinked retailer) under
    "customer", or None when the retailer does not exist.
    """

    with _get_engine().begin() as conn:
        current = _fetch_retailer(
            conn,
            retailer_id,
        )

        if current is None:
            return None

        if current["in_use"]:
            raise RetailerHasStoresError(
                f'"{current["retailer_name"]}" already has stores, '
                "sales or promotions, so it can't be deleted."
            )

        # The link row references the retailer, so it goes first.
        conn.execute(
            text(
                """
                DELETE FROM customer_retailers

                WHERE retailer_id = :retailer_id
                """
            ),
            {
                "retailer_id": retailer_id,
            },
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

        customer_id = current["customer_id"]

        return {
            "customer": (
                customer_service.fetch_customer(conn, customer_id)
                if customer_id is not None
                else None
            ),
        }


# ============================================================
# STORE HELPERS
#
# get_or_create_stores is the matching seam for promotion
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


def get_or_create_stores(
    conn: Connection,
    stores: list[dict],
) -> list[int]:
    """
    Upsert a batch of stores in one statement and return their
    store_ids in the same order as the input.

    Each item is {retailer_id, store_code, store_name,
    store_format}. The (retailer_id, store_code) pairs must be
    unique within the batch: Postgres rejects an INSERT that
    hits the same conflict row twice in one statement, and the
    request schema already enforces that.
    """

    if not stores:
        return []

    # On conflict the existing store_name is preserved: a
    # promotion write must not silently rename a store that
    # other promotions also point at.
    #
    # store_format uses COALESCE so an incoming value can
    # fill a gap on a store that has none, but can never
    # overwrite a format already recorded. Use the /stores
    # endpoints to change either field deliberately.
    #
    # RETURNING rows are not guaranteed to come back in input
    # order, so the natural key is returned too and the ids
    # are re-ordered in Python.
    query = text(
        """
        INSERT INTO stores (
            retailer_id,
            store_code,
            store_name,
            store_format
        )
        SELECT
            retailer_id,
            store_code,
            store_name,
            store_format

        FROM unnest(
            CAST(:retailer_ids AS integer[]),
            CAST(:store_codes AS text[]),
            CAST(:store_names AS text[]),
            CAST(:store_formats AS text[])
        ) AS input(
            retailer_id,
            store_code,
            store_name,
            store_format
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

        RETURNING
            retailer_id,
            store_code,
            store_id
        """
    )

    rows = conn.execute(
        query,
        {
            "retailer_ids": [item["retailer_id"] for item in stores],
            "store_codes": [item["store_code"] for item in stores],
            "store_names": [item["store_name"] for item in stores],
            "store_formats": [item["store_format"] for item in stores],
        },
    ).all()

    id_by_key = {
        (retailer_id, store_code): store_id
        for retailer_id, store_code, store_id in rows
    }

    return [
        id_by_key[(item["retailer_id"], item["store_code"])]
        for item in stores
    ]


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

    with _read_connection() as conn:
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
    with _read_connection() as conn:
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
            is_active = TRUE
            AND
            sku_range IS NOT NULL
            AND sku IS DISTINCT FROM sku_range

        ORDER BY
            sku_range ASC
        """
    )

    with _read_connection() as conn:
        results = conn.execute(
            query
        ).scalars().all()

    return list(results)


# ============================================================
# SKU READ ALL
#
# Full catalog rows, used by inventory_service to label SKU codes with
# product names. Same exclusion as get_sku_ranges: rows whose sku equals
# sku_range are leftover range-name inserts, not products.
# ============================================================


def get_skus() -> list[dict]:
    query = text(
        """
        SELECT
            sku,
            sku_range,
            product_name,
            size,
            brand,
            uom,
            pack_size,
            price

        FROM skus

        WHERE
            is_active = TRUE
            AND sku IS DISTINCT FROM sku_range

        ORDER BY
            product_name ASC,
            sku ASC
        """
    )

    with _read_connection() as conn:
        results = conn.execute(
            query
        ).mappings().all()

    return [
        dict(row)
        for row in results
    ]


# ============================================================
# SKU MANAGEMENT
#
# SKU codes are immutable and globally unique. Archiving keeps the master row
# (and therefore historical foreign keys) intact, while active catalog reads
# hide it. Every write records a complete snapshot in sku_history.
# ============================================================


_SKU_COLUMNS = """
    sku,
    sku_range,
    product_name,
    size,
    brand,
    uom,
    pack_size,
    price
"""

_SKU_READ_COLUMNS = """
    skus.sku,
    skus.sku_range,
    skus.product_name,
    skus.size,
    skus.brand,
    skus.uom,
    skus.pack_size,
    current_price.price,
    current_price.effective_from AS price_effective_from,
    current_price.effective_to AS price_effective_to
"""

_CURRENT_PRICE_JOIN = """
    LEFT JOIN LATERAL (
        SELECT price, effective_from, effective_to
        FROM sku_price_periods
        WHERE sku = skus.sku
          AND effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::DATE
          AND (effective_to IS NULL OR effective_to >=
               (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::DATE)
        ORDER BY effective_from DESC
        LIMIT 1
    ) AS current_price ON TRUE
"""


def _price_today() -> datetime.date:
    """SKU effective dates are Singapore business calendar dates."""
    return datetime.datetime.now(ZoneInfo("Asia/Singapore")).date()


def _fetch_active_sku(
    conn: Connection,
    sku: str,
) -> dict | None:
    row = conn.execute(
        text(
            f"""
            SELECT
                {_SKU_READ_COLUMNS}

            FROM skus
            {_CURRENT_PRICE_JOIN}

            WHERE
                sku = :sku
                AND is_active = TRUE
            """
        ),
        {"sku": sku},
    ).mappings().first()

    return dict(row) if row is not None else None


def _insert_sku_history(
    conn: Connection,
    sku: dict,
    action: str,
    effective_from: datetime.date | None = None,
    effective_to: datetime.date | None = None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO sku_history (
                sku,
                action,
                sku_range,
                product_name,
                size,
                brand,
                uom,
                pack_size,
                price,
                price_effective_from,
                price_effective_to
            )
            VALUES (
                :sku,
                :action,
                :sku_range,
                :product_name,
                :size,
                :brand,
                :uom,
                :pack_size,
                :price,
                :price_effective_from,
                :price_effective_to
            )
            """
        ),
        {
            **sku,
            "action": action,
            "price_effective_from": effective_from,
            "price_effective_to": effective_to,
        },
    )


def _insert_price_period(
    conn: Connection,
    sku: str,
    price,
    effective_from: datetime.date,
    effective_to: datetime.date | None,
) -> datetime.date | None:
    periods = [dict(row) for row in conn.execute(text("""
        SELECT price_period_id, price, effective_from, effective_to
        FROM sku_price_periods
        WHERE sku = :sku
        ORDER BY effective_from
        FOR UPDATE
    """), {"sku": sku}).mappings().all()]
    previous = next(
        (row for row in reversed(periods) if row["effective_from"] <= effective_from),
        None,
    )
    following = next(
        (row for row in periods if row["effective_from"] > effective_from),
        None,
    )
    if previous and previous["effective_from"] == effective_from:
        raise SkuPricePeriodConflictError(
            "A price period already starts on this date. "
            "To correct it, use History > Price periods > Edit."
        )
    if following and effective_to is not None and effective_to >= following["effective_from"]:
        raise SkuPricePeriodConflictError(
            "Effective to must be before the next scheduled price starts."
        )

    ends_on = effective_to
    if ends_on is None and following:
        ends_on = following["effective_from"] - datetime.timedelta(days=1)

    if previous and (previous["effective_to"] is None or previous["effective_to"] >= effective_from):
        conn.execute(text("""
            UPDATE sku_price_periods
            SET effective_to = :ends_on
            WHERE price_period_id = :period_id
        """), {
            "ends_on": effective_from - datetime.timedelta(days=1),
            "period_id": previous["price_period_id"],
        })

    conn.execute(text("""
        INSERT INTO sku_price_periods (sku, price, effective_from, effective_to)
        VALUES (:sku, :price, :effective_from, :effective_to)
    """), {
        "sku": sku,
        "price": price,
        "effective_from": effective_from,
        "effective_to": ends_on,
    })
    if following:
        conn.execute(text("""
            UPDATE skus SET price = :price WHERE sku = :sku
        """), {"price": periods[-1]["price"], "sku": sku})
    return ends_on


def create_sku(sku) -> dict:
    values = sku.model_dump()
    effective_from = sku.price_effective_from or _price_today()

    with _get_engine().begin() as conn:
        exists = conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM skus
                    WHERE sku = :sku
                )
                """
            ),
            {"sku": values["sku"]},
        ).scalar_one()

        if exists:
            raise SkuAlreadyExistsError(
                f"SKU {values['sku']} already exists or has been archived."
            )

        row = conn.execute(
            text(
                f"""
                INSERT INTO skus (
                    {_SKU_COLUMNS}
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
                RETURNING
                    {_SKU_COLUMNS}
                """
            ),
            values,
        ).mappings().first()

        created = dict(row)
        period_end = _insert_price_period(
            conn, created["sku"], created["price"], effective_from,
            sku.price_effective_to,
        )
        _insert_sku_history(
            conn, created, "created", effective_from, period_end,
        )

    if effective_from <= _price_today() and (
        period_end is None or period_end >= _price_today()
    ):
        return {**created, "price_effective_from": effective_from,
                "price_effective_to": period_end}
    return {**created, "price": None, "price_effective_from": None,
            "price_effective_to": None}


def list_skus(
    *,
    search: str | None = None,
    sku_range: str | None = None,
    brand: str | None = None,
    min_price=None,
    max_price=None,
) -> list[dict]:
    search_pattern = f"%{search.strip()}%" if search and search.strip() else None
    where_clauses = [
        "is_active = TRUE",
        "sku IS DISTINCT FROM sku_range",
    ]
    params = {}

    if search_pattern is not None:
        where_clauses.append(
            "(sku ILIKE :search OR sku_range ILIKE :search OR product_name ILIKE :search)"
        )
        params["search"] = search_pattern
    if sku_range is not None:
        where_clauses.append("sku_range = :sku_range")
        params["sku_range"] = sku_range
    if brand is not None:
        where_clauses.append("brand = :brand")
        params["brand"] = brand
    if min_price is not None:
        where_clauses.append("current_price.price >= :min_price")
        params["min_price"] = min_price
    if max_price is not None:
        where_clauses.append("current_price.price <= :max_price")
        params["max_price"] = max_price

    query = text(
        f"""
        SELECT
            {_SKU_READ_COLUMNS}

        FROM skus
        {_CURRENT_PRICE_JOIN}

        WHERE
            {" AND ".join(where_clauses)}

        ORDER BY
            product_name ASC,
            sku ASC
        """
    )

    with _read_connection() as conn:
        rows = conn.execute(query, params).mappings().all()

    return [dict(row) for row in rows]


def get_sku(sku: str) -> dict | None:
    with _read_connection() as conn:
        item = _fetch_active_sku(conn, sku)
        if item is None:
            return None

        history = conn.execute(
            text(
                f"""
                SELECT
                    sku_history_id,
                    action,
                    {_SKU_COLUMNS},
                    changed_at,
                    price_effective_from,
                    price_effective_to

                FROM sku_history

                WHERE sku = :sku

                ORDER BY
                    changed_at DESC,
                    sku_history_id DESC
                """
            ),
            {"sku": sku},
        ).mappings().all()

        price_periods = conn.execute(text("""
            SELECT price_period_id, price, effective_from, effective_to
            FROM sku_price_periods
            WHERE sku = :sku
            ORDER BY effective_from DESC, price_period_id DESC
        """), {"sku": sku}).mappings().all()
        price_corrections = conn.execute(text("""
            SELECT correction_id, price_period_id, old_price, new_price,
                   old_effective_from, old_effective_to,
                   new_effective_from, new_effective_to,
                   corrected_by, corrected_at
            FROM sku_price_period_corrections
            WHERE sku = :sku
            ORDER BY corrected_at DESC, correction_id DESC
        """), {"sku": sku}).mappings().all()

    item["history"] = [dict(row) for row in history]
    item["price_periods"] = [dict(row) for row in price_periods]
    item["price_corrections"] = [dict(row) for row in price_corrections]
    return item


def correct_sku_price_period(
    sku: str, period_id: int, correction, corrected_by: str,
) -> dict | None:
    """Correct saved dates while retaining the original interval in an audit row."""
    with _get_engine().begin() as conn:
        product = conn.execute(text("""
            SELECT sku FROM skus WHERE sku = :sku AND is_active = TRUE FOR UPDATE
        """), {"sku": sku}).first()
        if product is None:
            return None

        periods = [dict(row) for row in conn.execute(text("""
            SELECT price_period_id, price, effective_from, effective_to
            FROM sku_price_periods
            WHERE sku = :sku
            ORDER BY effective_from, price_period_id
            FOR UPDATE
        """), {"sku": sku}).mappings().all()]
        current = next((row for row in periods if row["price_period_id"] == period_id), None)
        if current is None:
            return None

        new_price = correction.price
        new_start = correction.effective_from
        new_end = correction.effective_to
        if (new_price, new_start, new_end) == (
            current["price"], current["effective_from"], current["effective_to"]
        ):
            return current

        for other in periods:
            if other["price_period_id"] == period_id:
                continue
            if new_start <= (other["effective_to"] or datetime.date.max) and (
                new_end is None or other["effective_from"] <= new_end
            ):
                raise SkuPricePeriodConflictError(
                    "These dates overlap another price period for this SKU."
                )

        conn.execute(text("""
            UPDATE sku_price_periods
            SET price = :price, effective_from = :effective_from,
                effective_to = :effective_to
            WHERE price_period_id = :period_id
        """), {
            "price": new_price,
            "effective_from": new_start,
            "effective_to": new_end,
            "period_id": period_id,
        })
        latest_period = max(
            periods,
            key=lambda row: new_start if row["price_period_id"] == period_id
            else row["effective_from"],
        )
        latest_price = new_price if latest_period["price_period_id"] == period_id else latest_period["price"]
        conn.execute(text("""
            UPDATE skus SET price = :price WHERE sku = :sku
        """), {"price": latest_price, "sku": sku})
        conn.execute(text("""
            INSERT INTO sku_price_period_corrections (
                price_period_id, sku, old_price, new_price,
                old_effective_from, old_effective_to,
                new_effective_from, new_effective_to, corrected_by
            ) VALUES (
                :period_id, :sku, :old_price, :new_price,
                :old_from, :old_to, :new_from, :new_to, :corrected_by
            )
        """), {
            "period_id": period_id,
            "sku": sku,
            "old_price": current["price"],
            "new_price": new_price,
            "old_from": current["effective_from"],
            "old_to": current["effective_to"],
            "new_from": new_start,
            "new_to": new_end,
            "corrected_by": corrected_by,
        })

    return {**current, "price": new_price,
            "effective_from": new_start, "effective_to": new_end}


def get_sku_options() -> dict[str, list]:
    query = text(
        """
        SELECT
            sku_range,
            brand,
            size,
            uom,
            pack_size

        FROM skus

        WHERE
            is_active = TRUE
            AND sku IS DISTINCT FROM sku_range
        """
    )

    with _read_connection() as conn:
        rows = conn.execute(query).mappings().all()

    def values_for(field: str) -> list:
        return sorted({row[field] for row in rows if row.get(field) is not None})

    return {
        "sku_ranges": values_for("sku_range"),
        "brands": values_for("brand"),
        "sizes": values_for("size"),
        "uoms": values_for("uom"),
        "pack_sizes": values_for("pack_size"),
    }


def update_sku(sku: str, changes) -> dict | None:
    with _get_engine().begin() as conn:
        current = conn.execute(text("""
            SELECT price FROM skus
            WHERE sku = :sku AND is_active = TRUE
            FOR UPDATE
        """), {"sku": sku}).first()
        if current is None:
            return None

        price_changed = (
            changes.price_changed if changes.price_changed is not None
            else changes.price != current[0] or changes.price_effective_from is not None
        )
        effective_from = (changes.price_effective_from or _price_today()) if price_changed else None
        params = {
            "sku": sku,
            **changes.model_dump(exclude={"price_changed"}),
            "price": changes.price if price_changed else current[0],
        }
        row = conn.execute(
            text(
                f"""
                UPDATE skus
                SET
                    sku_range = :sku_range,
                    product_name = :product_name,
                    size = :size,
                    brand = :brand,
                    uom = :uom,
                    pack_size = :pack_size,
                    price = :price

                WHERE
                    sku = :sku
                    AND is_active = TRUE

                RETURNING
                    {_SKU_COLUMNS}
                """
            ),
            params,
        ).mappings().first()

        if row is None:
            return None

        updated = dict(row)
        period_end = None
        if price_changed:
            period_end = _insert_price_period(
                conn, sku, updated["price"], effective_from,
                changes.price_effective_to,
            )
        _insert_sku_history(
            conn, updated, "updated", effective_from,
            period_end,
        )
        visible = _fetch_active_sku(conn, sku)

    return visible


def archive_sku(sku: str) -> dict | None:
    with _get_engine().begin() as conn:
        item = _fetch_active_sku(conn, sku)
        if item is None:
            return None

        has_promotions = conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM promotion_skus
                    WHERE sku = :sku
                )
                """
            ),
            {"sku": sku},
        ).scalar_one()

        if has_promotions:
            raise SkuHasPromotionsError(
                "SKU cannot be archived because it is attached to promotions."
            )

        _insert_sku_history(conn, item, "archived")
        conn.execute(
            text(
                """
                UPDATE skus
                SET
                    is_active = FALSE,
                    archived_at = CURRENT_TIMESTAMP
                WHERE sku = :sku
                """
            ),
            {"sku": sku},
        )

    return item


# ============================================================
# PRODUCT PRICES
#
# Price periods are dated Singapore business days. SKU history still supplies
# the product name as it was known on a historical date.
# ============================================================


def get_product_prices(
    as_of_date: datetime.date | None = None,
) -> dict[str, float]:
    """Return SKU prices effective today or on a requested past date."""
    params = {}
    if as_of_date is None:
        query = text(
            """
            SELECT
                skus.product_name,
                current_price.price

            FROM skus
            JOIN LATERAL (
                SELECT price FROM sku_price_periods
                WHERE sku = skus.sku
                  AND effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::DATE
                  AND (effective_to IS NULL OR effective_to >=
                       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::DATE)
                ORDER BY effective_from DESC LIMIT 1
            ) AS current_price ON TRUE

            WHERE
                current_price.price IS NOT NULL AND skus.is_active = TRUE
            """
        )
    else:
        query = text(
            """
            WITH effective_versions AS (
                SELECT DISTINCT ON (sku)
                    sku,
                    action,
                    product_name,
                    price

                FROM sku_history

                ORDER BY
                    sku,
                    ((changed_at AT TIME ZONE 'Asia/Singapore') <
                     CAST(:as_of_date AS DATE) + INTERVAL '1 day') DESC,
                    CASE
                        WHEN (changed_at AT TIME ZONE 'Asia/Singapore') <
                             CAST(:as_of_date AS DATE) + INTERVAL '1 day'
                        THEN changed_at
                    END DESC,
                    CASE
                        WHEN (changed_at AT TIME ZONE 'Asia/Singapore') >=
                             CAST(:as_of_date AS DATE) + INTERVAL '1 day'
                        THEN changed_at
                    END ASC,
                    CASE
                        WHEN (changed_at AT TIME ZONE 'Asia/Singapore') <
                             CAST(:as_of_date AS DATE) + INTERVAL '1 day'
                        THEN sku_history_id
                    END DESC,
                    CASE
                        WHEN (changed_at AT TIME ZONE 'Asia/Singapore') >=
                             CAST(:as_of_date AS DATE) + INTERVAL '1 day'
                        THEN sku_history_id
                    END ASC
            )
            SELECT
                effective_versions.product_name,
                period.price

            FROM effective_versions
            JOIN sku_price_periods AS period
              ON period.sku = effective_versions.sku
             AND period.effective_from <= CAST(:as_of_date AS DATE)
             AND (period.effective_to IS NULL
                  OR period.effective_to >= CAST(:as_of_date AS DATE))

            WHERE
                effective_versions.action <> 'archived'
                AND effective_versions.product_name IS NOT NULL
                AND period.price IS NOT NULL
            """
        )
        params["as_of_date"] = as_of_date

    with _read_connection() as conn:
        rows = conn.execute(query, params).all()

    return {
        product_name: float(price)
        for product_name, price in rows
    }
