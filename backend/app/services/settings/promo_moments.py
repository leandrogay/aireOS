from calendar import monthrange
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services import sellout_units
from app.services.settings import common
from app.services.settings import promo_moment_rules as rules
from app.services.settings import promo_uplift_rules as uplift_rules


# Moments and Recommended Uplift for Promotion Uplift Settings, read-only:
# offline promotions (promotions -> promotion_skus / promotion_stores ->
# stores -> a customer's {customer}_offline retailer) and the same retailers'
# monthly sell-out (sellout_units, the effective-sellout view). The rules
# are pure and live in promo_moment_rules.py.
#
# A promotion_stores row whose store no longer exists joins to no customer,
# so its promotion is left out; the counts are low until those links are
# repaired.


_OFFLINE_SUFFIX = "_offline"


def _offline_retailers(conn: Connection) -> dict[int, list[int]]:
    rows = conn.execute(
        text(
            """
            SELECT
                cr.customer_id,
                cr.retailer_id

            FROM customer_retailers cr
            JOIN retailers r
                ON r.retailer_id = cr.retailer_id

            WHERE
                r.retailer_name LIKE '%' || :suffix
            """
        ),
        {"suffix": _OFFLINE_SUFFIX},
    ).mappings().all()

    by_customer: dict[int, list[int]] = {}
    for row in rows:
        by_customer.setdefault(row["customer_id"], []).append(row["retailer_id"])
    return by_customer


def _offline_promotions(conn: Connection) -> list[dict]:
    """One row per promotion x customer x SKU, over the customer's offline stores."""

    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                cr.customer_id,
                psk.sku,
                p.promotion_id,
                p.period_start,
                p.period_end,
                p.promo_type::text AS promo_type,
                p.promotion_mechanic

            FROM promotions p
            JOIN promotion_skus psk
                ON psk.promotion_id = p.promotion_id
            JOIN promotion_stores pst
                ON pst.promotion_id = p.promotion_id
            JOIN stores s
                ON s.store_id = pst.store_id
            JOIN retailers r
                ON r.retailer_id = s.retailer_id
            JOIN customer_retailers cr
                ON cr.retailer_id = r.retailer_id

            WHERE
                r.retailer_name LIKE '%' || :suffix
            """
        ),
        {"suffix": _OFFLINE_SUFFIX},
    ).mappings().all()
    return [dict(row) for row in rows]


def _customer_names(conn: Connection) -> dict[int, str]:
    rows = conn.execute(text("SELECT customer_id, customer_name FROM customers")).mappings().all()
    return {row["customer_id"]: row["customer_name"] for row in rows}


def _products(conn: Connection) -> dict[str, dict]:
    rows = conn.execute(text("SELECT sku, product_name, sku_range FROM skus")).mappings().all()
    return {row["sku"]: dict(row) for row in rows}


def _complete_units(by_sku: dict[str, dict[date, float]], data_through: date | None) -> dict[str, dict[date, float]]:
    # The latest month only counts once the data reaches its last day.
    if data_through is None:
        return {}
    return {
        sku: {
            month: units
            for month, units in months.items()
            if month.replace(day=monthrange(month.year, month.month)[1]) <= data_through
        }
        for sku, months in by_sku.items()
    }


def _units_by_product(conn: Connection, retailers: dict[int, list[int]]) -> dict[tuple[int, str], dict[date, float]]:
    units: dict[tuple[int, str], dict[date, float]] = {}
    for customer_id, retailer_ids in retailers.items():
        by_sku, data_through = sellout_units.get_monthly_sellout(retailer_ids, conn)
        for sku, months in _complete_units(by_sku, data_through).items():
            units[(customer_id, sku)] = months
    return units


def _named(row: dict, customers: dict[int, str], products: dict[str, dict]) -> dict:
    product = products.get(row["sku"], {})
    return {
        **row,
        "customer_name": customers.get(row["customer_id"]),
        "product_name": product.get("product_name"),
        "sku_range": product.get("sku_range"),
    }


def _saved_baselines(conn: Connection) -> dict[tuple[int, str], str | None]:
    """
    The saved anchor mechanic per customer x SKU range (promo_anchor_settings,
    newest row per target), the range's own else its customer's; None where
    the anchor is a typed discount. Ranges with neither are left out, so
    measure_moments uses their most common mechanic.
    """

    rows = conn.execute(
        text(
            """
            SELECT
                anchor_id AS id,
                customer_id,
                sku_range,
                promotion_mechanic,
                updated_at

            FROM promo_anchor_settings

            WHERE
                customer_id IS NOT NULL
            """
        )
    ).mappings().all()

    current = common.newest([dict(row) for row in rows], lambda row: (row["customer_id"], row["sku_range"]))
    customer_level = {
        customer_id: uplift_rules.mechanic_key(row["promotion_mechanic"])
        for (customer_id, sku_range), row in current.items()
        if sku_range is None
    }
    ranges = conn.execute(text("SELECT DISTINCT sku_range FROM skus WHERE sku_range IS NOT NULL")).all()

    baselines = {}
    for customer_id in {customer_id for customer_id, _ in current}:
        for (sku_range,) in ranges:
            row = current.get((customer_id, sku_range))
            if row is not None:
                baselines[(customer_id, sku_range)] = uplift_rules.mechanic_key(row["promotion_mechanic"])
            elif customer_id in customer_level:
                baselines[(customer_id, sku_range)] = customer_level[customer_id]
    return baselines


def _found_moments(conn: Connection) -> tuple[list[dict], dict[str, dict]]:
    retailers = _offline_retailers(conn)
    promotions = _offline_promotions(conn)
    units = _units_by_product(conn, retailers)
    return rules.find_moments(promotions, units), _products(conn)


def anchor_recommendations(conn: Connection) -> dict[tuple[int, str | None], dict]:
    """The recommended anchor per customer x SKU range and per customer (promo_moment_rules.recommend_anchors)."""

    moments, products = _found_moments(conn)
    sku_ranges = {sku: product.get("sku_range") for sku, product in products.items()}
    return rules.recommend_anchors(moments, sku_ranges)


def list_moments() -> dict:
    """
    Every offline moment with its uplift measured against its range's saved
    anchor, and the Recommended Uplift per customer x SKU x mechanic
    (average of the latest moments).
    """

    with common.read_connection() as conn:
        moments, products = _found_moments(conn)
        customers = _customer_names(conn)
        baselines = _saved_baselines(conn)

    sku_ranges = {sku: product.get("sku_range") for sku, product in products.items()}
    measured = rules.measure_moments(moments, sku_ranges, baselines)
    recommendations = rules.recommend(measured)

    return {
        "baseline_method": rules.BASELINE_METHOD,
        "recommend_from": rules.RECOMMEND_FROM,
        "moments": [
            {**_named(moment, customers, products), "month": moment["month"].isoformat()}
            for moment in measured
        ],
        "recommendations": [_named(row, customers, products) for row in recommendations],
    }
