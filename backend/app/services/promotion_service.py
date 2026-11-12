import json
from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from app.schemas.promotions import PromoType
from app.services import forecast_refresh_events, sql
from app.services.settings import promo_recalc_events
from app.services.catalog_service import (
    get_or_create_retailers,
    get_or_create_stores,
)


# ============================================================
# ERRORS
# ============================================================


class PromotionClashError(Exception):
    """
    The promotion would repeat an event (same dates, promo type and
    mechanic) in stores that already run it. `stores` are the clashing
    request refs, for the message.
    """

    def __init__(self, stores: list):
        self.stores = stores
        names = "; ".join(f"{ref.retailer} / {ref.store_name}" for ref in stores)
        super().__init__(f"This combination already exists for {names}.")


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
# promotion_stores. The refs are resolved through the catalog
# get_or_create seams so the rows exist before the links are
# written.
#
# Everything here is batched: a request with N stores costs
# three round trips (retailers, stores, links), not 3N. At
# ~200ms per round trip to Cloud SQL that is what keeps an
# "all stores" promotion under a second.
# ============================================================


# pg8000 sends a list-of-dicts as one statement per row, so
# the links are inserted from unnest()ed arrays instead.
_INSERT_PROMOTION_STORES = text(
    """
    INSERT INTO promotion_stores (
        promotion_id,
        store_id
    )
    SELECT
        :promotion_id,
        store_id

    FROM unnest(
        CAST(:store_ids AS integer[])
    ) AS input(store_id)

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
    if not store_refs:
        return []

    retailer_ids = get_or_create_retailers(
        conn,
        [ref.retailer for ref in store_refs],
    )

    store_ids = get_or_create_stores(
        conn,
        [
            {
                "retailer_id": retailer_ids[ref.retailer],
                "store_code": ref.store_code,
                "store_name": ref.store_name,
                "store_format": ref.store_format,
            }
            for ref in store_refs
        ],
    )

    # dict.fromkeys drops duplicates while keeping order.
    return list(dict.fromkeys(store_ids))


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
        _INSERT_PROMOTION_STORES,
        {
            "promotion_id": promotion_id,
            "store_ids": store_ids,
        },
    )


# ============================================================
# DUPLICATE EVENTS
#
# A store runs one event (period, promo type, mechanic) once.
# Voucher and SKU changes do not make a new event. The check
# runs inside the write's transaction, against every stored
# promotion -- the overview only ever holds one page of them.
# ============================================================


def _store_key(retailer: str | None, store_code) -> str:
    """retailer + store_code, the stores natural key (utils/promotionOverview promotionStoreKey)."""
    return f"{(retailer or '').strip().lower()}|{str(store_code or '').strip()}"


def _covered_store_keys(
    conn: Connection,
    promotion,
    exclude_id: int | None = None,
) -> set[str]:
    """Store keys already running this promotion's event, other than `exclude_id`."""
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                r.retailer_name,
                CAST(s.store_code AS text) AS store_code

            FROM promotions p

            JOIN promotion_stores pst
                ON pst.promotion_id = p.promotion_id

            JOIN stores s
                ON s.store_id = pst.store_id

            JOIN retailers r
                ON r.retailer_id = s.retailer_id

            WHERE
                p.period_start = :period_start
                AND p.period_end = :period_end
                AND CAST(p.promo_type AS text) = :promo_type
                AND TRIM(COALESCE(p.promotion_mechanic, '')) = :mechanic
                AND (
                    CAST(:exclude_id AS integer) IS NULL
                    OR p.promotion_id <> CAST(:exclude_id AS integer)
                )
            """
        ),
        {
            "period_start": promotion.period_start,
            "period_end": promotion.period_end,
            "promo_type": promotion.promo_type,
            "mechanic": (promotion.promotion_mechanic or "").strip(),
            "exclude_id": exclude_id,
        },
    ).all()

    return {_store_key(retailer, code) for retailer, code in rows}


def _split_covered_stores(
    conn: Connection,
    promotion,
    exclude_id: int | None = None,
) -> tuple[list, list]:
    """The request's store refs as (new, already running this event)."""
    covered = _covered_store_keys(conn, promotion, exclude_id)
    new, clashing = [], []
    for ref in promotion.stores:
        if _store_key(ref.retailer, ref.store_code) in covered:
            clashing.append(ref)
        else:
            new.append(ref)
    return new, clashing


# ============================================================
# SKU HELPERS
#
# `skus` is catalog master data. Promotion writes must not
# insert or rewrite those rows. A ticked range is resolved to
# the product SKUs already stored for that sku_range, then
# linked through promotion_skus only.
# ============================================================


_UPSERT_PROMOTION_SKUS = text(
    """
    INSERT INTO promotion_skus (
        promotion_id,
        sku,
        quantity_units
    )
    SELECT
        :promotion_id,
        sku,
        NULL

    FROM unnest(
        CAST(:skus AS text[])
    ) AS input(sku)

    ON CONFLICT (
        promotion_id,
        sku
    )
    DO UPDATE SET
        quantity_units = EXCLUDED.quantity_units
    """
)


def _skus_by_range(
    conn: Connection,
    range_names: list[str],
) -> dict[str, list[str]]:
    # Rows whose sku equals sku_range are leftover range-name
    # inserts, not catalog products, so they are excluded.
    if not range_names:
        return {}

    rows = conn.execute(
        text(
            """
            SELECT
                sku_range,
                sku

            FROM skus

            WHERE
                is_active = TRUE
                AND sku_range = ANY(CAST(:sku_ranges AS text[]))
                AND sku IS DISTINCT FROM sku_range

            ORDER BY
                sku
            """
        ),
        {
            "sku_ranges": range_names,
        },
    ).all()

    found: dict[str, list[str]] = {}

    for sku_range, sku in rows:
        found.setdefault(sku_range, []).append(sku)

    return found


def _existing_skus(
    conn: Connection,
    sku_codes: list[str],
) -> set[str]:
    if not sku_codes:
        return set()

    rows = conn.execute(
        text(
            """
            SELECT
                sku

            FROM skus

            WHERE
                is_active = TRUE
                AND sku = ANY(CAST(:skus AS text[]))
            """
        ),
        {
            "skus": sku_codes,
        },
    ).scalars().all()

    return set(rows)


def _catalog_skus_for_items(
    conn: Connection,
    sku_items: list,
) -> list[str]:
    # Prefer sku_range so a form tick like "Aire Adult Diaper
    # Pants" maps to every catalog product in that range, not
    # to a fake skus row whose pk equals the range name. Only
    # items whose range matched nothing fall back to an exact
    # sku lookup, so the whole list costs at most two queries.
    range_names = [
        name
        for item in sku_items
        if (name := (item.sku_range or "").strip())
    ]

    by_range = _skus_by_range(conn, range_names)

    fallback_codes = [
        code
        for item in sku_items
        if not by_range.get((item.sku_range or "").strip())
        and (code := (item.sku or "").strip())
    ]

    existing = _existing_skus(conn, fallback_codes)

    codes: list[str] = []
    seen: set[str] = set()

    for item in sku_items:
        range_name = (item.sku_range or "").strip()
        sku_code = (item.sku or "").strip()

        found = by_range.get(range_name, [])

        if not found and sku_code in existing:
            found = [sku_code]

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
        _UPSERT_PROMOTION_SKUS,
        {
            "promotion_id": promotion_id,
            "skus": codes,
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
    """
    Insert one promotion with its store and SKU links, in one transaction.

    Stores already running this exact event are left out rather than
    duplicated and returned as `skipped_stores`; when every store is
    already running it, PromotionClashError and nothing is written.
    """
    with _get_engine().begin() as conn:
        new_stores, skipped = _split_covered_stores(conn, promotion)

        if not new_stores:
            raise PromotionClashError(skipped)

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
            new_stores,
        )

        _add_skus_to_promotion(
            conn,
            promotion_id,
            promotion.skus,
        )

        created = _fetch_promotion(
            conn,
            promotion_id,
        )
        created["skipped_stores"] = [
            {"retailer": ref.retailer, "store_name": ref.store_name, "store_code": ref.store_code}
            for ref in skipped
        ]
        refresh_request_id = forecast_refresh_events.record_change(
            conn, "promotion_change", f"promotion:{promotion_id}"
        )
        recalc_recorded = promo_recalc_events.record_promotion(conn, promotion_id)

    forecast_refresh_events.enqueue_best_effort(refresh_request_id)
    promo_recalc_events.enqueue_best_effort(recalc_recorded)
    return created


# ============================================================
# FORECAST PAGE PROMOS
#
# The forecast table no longer stores promo columns. The page
# reads overlapping events from promotions / promotion_skus /
# promotion_stores and matches fairprice to channel retailers.
# ============================================================


def _iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def _as_sku_list(value) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _forecast_promo_row(record: dict) -> dict:
    return {
        "promotion_id": record.get("promotion_id"),
        "period_start": _iso_date(record.get("period_start")),
        "period_end": _iso_date(record.get("period_end")),
        "period_label": record.get("period_label"),
        "promo_type": record.get("promo_type"),
        "promotion_mechanic": record.get("promotion_mechanic"),
        "voucher": record.get("voucher"),
        "skus": _as_sku_list(record.get("skus")),
    }


def list_forecast_promotions(
    product_name: str | None = None,
    customer_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    sku_range: str | None = None,
) -> list[dict]:
    """Promos that apply to the Forecast page for one customer x SKU window.

    A promo is included when its dates overlap the requested range, it is
    linked to the chosen product_name and/or a SKU of the chosen sku_range
    (or any product when those filters are empty), and it has at least one
    store on {customer}_offline or
    {customer}_online. Forecast customer is the family name (fairprice),
    not the channel.
    """
    where_clauses = ["1 = 1"]
    params: dict = {}

    if start_date:
        where_clauses.append("p.period_end >= :start_date")
        params["start_date"] = start_date
    if end_date:
        where_clauses.append("p.period_start <= :end_date")
        params["end_date"] = end_date
    if product_name:
        where_clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM promotion_skus ps
                JOIN skus sk
                    ON sk.sku = ps.sku
                WHERE
                    ps.promotion_id = p.promotion_id
                    AND sk.product_name = :product_name
            )
            """
        )
        params["product_name"] = product_name
    if sku_range:
        where_clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM promotion_skus ps
                JOIN skus sk
                    ON sk.sku = ps.sku
                WHERE
                    ps.promotion_id = p.promotion_id
                    AND sk.sku_range = :sku_range
            )
            """
        )
        params["sku_range"] = sku_range
    if customer_name:
        where_clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM promotion_stores pst
                JOIN stores s
                    ON s.store_id = pst.store_id
                JOIN retailers r
                    ON r.retailer_id = s.retailer_id
                WHERE
                    pst.promotion_id = p.promotion_id
                    AND (
                        r.retailer_name IN (
                            :customer_offline,
                            :customer_online
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM customer_retailers cr
                            JOIN customers c
                                ON c.customer_id = cr.customer_id
                            WHERE
                                cr.retailer_id = r.retailer_id
                                AND LOWER(c.customer_name) = LOWER(:customer_name)
                        )
                    )
            )
            """
        )
        # Customer names keep their capitals (FairPrice) but retailer names
        # are lowercase slugs (fairprice_offline), and a renamed customer's
        # retailers keep their old slug -- so match the customer's linked
        # retailers, with the slug as a fallback for unlinked ones.
        params["customer_name"] = customer_name
        params["customer_offline"] = f"{customer_name.lower()}_offline"
        params["customer_online"] = f"{customer_name.lower()}_online"

    query = text(
        f"""
        SELECT
            p.promotion_id,
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
                            sk.product_name
                        FROM promotion_skus ps
                        JOIN skus sk
                            ON sk.sku = ps.sku
                        WHERE
                            ps.promotion_id = p.promotion_id
                    ) AS line
                ),
                '[]'::json
            ) AS skus
        {_PROMOTION_JOINS}
        WHERE {" AND ".join(where_clauses)}
        ORDER BY
            p.period_start,
            p.promotion_id
        """
    )

    with _get_engine().connect() as conn:
        results = conn.execute(query, params).mappings().all()

    return [_forecast_promo_row(dict(row)) for row in results]


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
# PROMOTION OVERVIEW PAGE
#
# The Promotions page lists one page at a time: filtered,
# searched, sorted and paged here in SQL, because the table
# grows with every event x store and each row carries its
# store and SKU lists. Only the page's rows are aggregated.
#
# Older copies of one promotion (same event and the same store
# set) are hidden, newest promotion_id kept -- read-only, the
# rows themselves are never changed. New copies cannot appear:
# create and update refuse a store already running the event.
# ============================================================


PROMOTION_SORT_FIELDS = ("period_start", "period_end")
SORT_DIRECTIONS = ("asc", "desc")
PROMOTION_STATUSES = ("upcoming", "active", "past")

# What the overview shows for each promo type, so a search for
# "side offer" finds side_offer. Mirrors PROMO_TYPES and
# promoTypeLabel in app/utils/promotionForm.js.
_PROMO_TYPE_LABELS = {
    "monthly": "Monthly",
    "side_offer": "Side Offer",
    "bundle": "Bundle",
    "others": "Others",
}
_STATUS_LABELS = {"upcoming": "Upcoming", "active": "Active", "past": "Past"}

# Every word typed must match somewhere; more than this many
# words is not a search a person types.
_MAX_SEARCH_WORDS = 10

_VISIBLE_PROMOTIONS_CTE = """
    store_sets AS (
        SELECT
            p.promotion_id,
            ROW_NUMBER() OVER (
                PARTITION BY
                    p.period_start,
                    p.period_end,
                    CAST(p.promo_type AS text),
                    TRIM(COALESCE(p.promotion_mechanic, '')),
                    store_keys.store_set
                ORDER BY
                    p.promotion_id DESC
            ) AS copy_rank

        FROM promotions p

        LEFT JOIN LATERAL (
            SELECT
                string_agg(DISTINCT link.store_key, ',' ORDER BY link.store_key) AS store_set

            FROM (
                SELECT
                    LOWER(TRIM(r.retailer_name)) || '|' || TRIM(CAST(s.store_code AS text)) AS store_key

                FROM promotion_stores pst

                JOIN stores s
                    ON s.store_id = pst.store_id

                JOIN retailers r
                    ON r.retailer_id = s.retailer_id

                WHERE
                    pst.promotion_id = p.promotion_id
            ) AS link
        ) AS store_keys ON TRUE
    ),

    visible AS (
        SELECT promotion_id
        FROM store_sets
        WHERE copy_rank = 1
    )
"""

_STORE_LINK_EXISTS = """
    EXISTS (
        SELECT 1

        FROM promotion_stores pst

        JOIN stores s
            ON s.store_id = pst.store_id

        JOIN retailers r
            ON r.retailer_id = s.retailer_id

        WHERE
            pst.promotion_id = p.promotion_id
            AND ({condition})
    )
"""

# Status against the Singapore calendar day, as the overview
# shows it (promotionStatus in utils/promotionOverview.js):
# before the start is upcoming, after the end is past.
_UPCOMING_SQL = "(p.period_start IS NOT NULL AND CAST(:today AS date) < p.period_start)"
_ENDED_SQL = "(p.period_end IS NOT NULL AND CAST(:today AS date) > p.period_end)"
_STATUS_SQL = {
    "upcoming": _UPCOMING_SQL,
    "past": f"(NOT {_UPCOMING_SQL} AND {_ENDED_SQL})",
    "active": f"(NOT {_UPCOMING_SQL} AND NOT {_ENDED_SQL})",
}


def _singapore_today() -> date:
    return datetime.now(ZoneInfo("Asia/Singapore")).date()


def _promo_type_label(value: str) -> str:
    base = value.removeprefix("carton_")
    label = _PROMO_TYPE_LABELS.get(base, value)
    return f"Carton {label}" if value.startswith("carton_") else label


def _like_pattern(word: str) -> str:
    """`word` anywhere, with LIKE's own wildcards taken literally."""
    escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _search_clauses(search: str, params: dict) -> list[str]:
    """
    One clause per word typed, each matching what a row shows:
    retailer (slug or its label) or the customer that owns it, store,
    period, promo type label, mechanic, voucher, status label.
    """
    words = search.lower().split()[:_MAX_SEARCH_WORDS]
    clauses = []

    for index, word in enumerate(words):
        name = f"word_{index}"
        params[name] = _like_pattern(word)
        like = f"ILIKE :{name} ESCAPE '\\'"

        # The owning customer's name too: a retailer keeps its slug when
        # its customer is renamed (sheng_siong_offline under Sheng_Shiong),
        # so the slug alone misses the name people type.
        customer_match = f"""
            EXISTS (
                SELECT 1

                FROM customer_retailers cr

                JOIN customers c
                    ON c.customer_id = cr.customer_id

                WHERE
                    cr.retailer_id = r.retailer_id
                    AND (
                        c.customer_name {like}
                        OR REPLACE(c.customer_name, '_', ' ') {like}
                    )
            )
        """
        options = [
            _STORE_LINK_EXISTS.format(condition=(
                f"r.retailer_name {like}"
                f" OR REPLACE(r.retailer_name, '_', ' ') {like}"
                f" OR s.store_name {like}"
                f" OR {customer_match}"
            )),
            f"p.period_label {like}",
            f"p.promotion_mechanic {like}",
            f"p.voucher {like}",
        ]

        types = [
            promo_type for promo_type in PromoType.__args__
            if word in _promo_type_label(promo_type).lower()
        ]
        if types:
            params[f"{name}_types"] = types
            options.append(f"CAST(p.promo_type AS text) = ANY(CAST(:{name}_types AS text[]))")

        options.extend(
            _STATUS_SQL[status]
            for status, label in _STATUS_LABELS.items()
            if word in label.lower()
        )

        clauses.append("(" + " OR ".join(options) + ")")

    return clauses


def _filter_clauses(filters: dict, params: dict) -> list[str]:
    """The filter bar's choices; an empty list means "all"."""
    clauses = []

    for key, column in (
        ("retailer", "r.retailer_name"),
        ("store", "s.store_name"),
    ):
        if filters[key]:
            params[key] = filters[key]
            clauses.append(_STORE_LINK_EXISTS.format(
                condition=f"{column} = ANY(CAST(:{key} AS text[]))"
            ))

    for key, column in (
        ("period", "p.period_label"),
        ("promo_type", "CAST(p.promo_type AS text)"),
        ("mechanic", "p.promotion_mechanic"),
    ):
        if filters[key]:
            params[key] = filters[key]
            clauses.append(f"{column} = ANY(CAST(:{key} AS text[]))")

    if filters["status"]:
        clauses.append("(" + " OR ".join(_STATUS_SQL[value] for value in filters["status"]) + ")")

    return clauses


def _clamped_offset(offset: int, limit: int, total: int) -> int:
    """`offset`, or the start of the last page when it is past the end."""
    if offset < total:
        return offset
    return max(0, (total - 1) // limit) * limit


def list_promotion_page(
    *,
    limit: int,
    offset: int = 0,
    search: str = "",
    sort: str = "period_start",
    direction: str = "desc",
    retailer: list[str] | str = "",
    store: list[str] | str = "",
    period: list[str] | str = "",
    promo_type: list[str] | str = "",
    mechanic: list[str] | str = "",
    status: list[str] | str = "",
    today: date | None = None,
) -> dict:
    """
    One page of the promotion overview, plus how many match (`total`) and
    how many there are before filters and search (`unfiltered_total`).

    An `offset` past the end is moved back to the last page rather than
    returning an empty one, so deleting the last row of the last page lands
    on the new last page; the offset actually used is returned. Ties on the
    sorted date go newest promotion first, either direction.
    """
    if sort not in PROMOTION_SORT_FIELDS:
        raise ValueError(f"sort must be one of {', '.join(PROMOTION_SORT_FIELDS)}")
    if direction not in SORT_DIRECTIONS:
        raise ValueError(f"direction must be one of {', '.join(SORT_DIRECTIONS)}")
    def values(choice: list[str] | str) -> list[str]:
        if isinstance(choice, str):
            return [choice] if choice else []
        return list(choice)

    if any(value not in PROMOTION_STATUSES for value in values(status)):
        raise ValueError(f"status must be one of {', '.join(PROMOTION_STATUSES)}")

    params: dict = {"today": today or _singapore_today()}
    filters = {
        "retailer": values(retailer),
        "store": values(store),
        "period": values(period),
        "promo_type": values(promo_type),
        "mechanic": values(mechanic),
        "status": values(status),
    }
    where = _filter_clauses(filters, params) + _search_clauses(search, params)
    where_sql = " AND ".join(where) if where else "TRUE"

    with _get_engine().connect() as conn:
        counts = conn.execute(
            text(
                f"""
                WITH {_VISIBLE_PROMOTIONS_CTE}

                SELECT
                    (SELECT COUNT(*) FROM visible) AS unfiltered_total,
                    (
                        SELECT COUNT(*)
                        FROM promotions p
                        JOIN visible v
                            ON v.promotion_id = p.promotion_id
                        WHERE {where_sql}
                    ) AS total
                """
            ),
            params,
        ).mappings().first()

        total = int(counts["total"])
        offset = _clamped_offset(offset, limit, total)

        # sort and direction were checked against the tuples above,
        # so they are trusted fragments here.
        rows = conn.execute(
            text(
                f"""
                WITH {_VISIBLE_PROMOTIONS_CTE}

                SELECT
                    {_PROMOTION_COLUMNS}

                FROM promotions p

                JOIN visible v
                    ON v.promotion_id = p.promotion_id

                WHERE {where_sql}

                ORDER BY
                    p.{sort} {direction.upper()},
                    p.promotion_id DESC

                LIMIT :limit
                OFFSET :offset
                """
            ),
            {**params, "limit": limit, "offset": offset},
        ).mappings().all()

    return {
        "promotions": [dict(row) for row in rows],
        "total": total,
        "unfiltered_total": int(counts["unfiltered_total"]),
        "limit": limit,
        "offset": offset,
    }


_STORE_OPTION_SQL = """
    WITH {cte}

    SELECT DISTINCT {column} AS value

    FROM visible v

    JOIN promotion_stores pst
        ON pst.promotion_id = v.promotion_id

    JOIN stores s
        ON s.store_id = pst.store_id

    JOIN retailers r
        ON r.retailer_id = s.retailer_id

    WHERE {column} IS NOT NULL AND {column} <> ''

    ORDER BY value
"""

_PROMOTION_OPTION_SQL = """
    WITH {cte}

    SELECT DISTINCT {column} AS value

    FROM promotions p

    JOIN visible v
        ON v.promotion_id = p.promotion_id

    WHERE {column} IS NOT NULL AND {column} <> ''

    ORDER BY value
"""

# Filter key -> (query template, column). Trusted fragments only.
_FILTER_OPTION_COLUMNS = {
    "retailers": (_STORE_OPTION_SQL, "r.retailer_name"),
    "stores": (_STORE_OPTION_SQL, "s.store_name"),
    "periods": (_PROMOTION_OPTION_SQL, "p.period_label"),
    "types": (_PROMOTION_OPTION_SQL, "CAST(p.promo_type AS text)"),
    "mechanics": (_PROMOTION_OPTION_SQL, "p.promotion_mechanic"),
}


def get_promotion_filter_options() -> dict:
    """
    The values the overview's filter dropdowns offer, taken from every
    listed promotion rather than the page on screen.
    """
    with _get_engine().connect() as conn:
        return {
            key: list(
                conn.execute(
                    text(template.format(cte=_VISIBLE_PROMOTIONS_CTE, column=column))
                ).scalars().all()
            )
            for key, (template, column) in _FILTER_OPTION_COLUMNS.items()
        }


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

        _, clashing = _split_covered_stores(conn, promotion, exclude_id=promotion_id)
        if clashing:
            raise PromotionClashError(clashing)

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

        # Its customers before the change also need their uplifts worked out again.
        promo_recalc_events.record_promotion(conn, promotion_id)

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

        updated = _fetch_promotion(
            conn,
            promotion_id,
        )
        refresh_request_id = forecast_refresh_events.record_change(
            conn, "promotion_change", f"promotion:{promotion_id}"
        )
        recalc_recorded = promo_recalc_events.record_promotion(conn, promotion_id)

    forecast_refresh_events.enqueue_best_effort(refresh_request_id)
    promo_recalc_events.enqueue_best_effort(recalc_recorded)
    return updated


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

        recalc_recorded = promo_recalc_events.record_promotion(conn, promotion_id)

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

        refresh_request_id = forecast_refresh_events.record_change(
            conn, "promotion_change", f"promotion:{promotion_id}"
        )

    forecast_refresh_events.enqueue_best_effort(refresh_request_id)
    promo_recalc_events.enqueue_best_effort(recalc_recorded)
    return True
