from calendar import monthrange
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services import sellout_units
from app.services.settings import common
from app.services.settings import promo_moment_rules as rules


# Moments and Recommended Uplift for Promotion Uplift Settings.
#
# The inputs: offline promotions (promotions -> promotion_skus /
# promotion_stores -> stores -> a customer's {customer}_offline retailer) and
# the same retailers' monthly sell-out (sellout_units, the effective-sellout
# view), read per customer by promo_recalc when its inputs change.
#
# The reads: the worked-out moments in promo_moment_calc (migration 020),
# each measured against the anchor version of its own month, so a page load
# never reads sell-out. The rules are pure and live in promo_moment_rules.py
# and promo_anchor_versions.py.
#
# A promotion_stores row whose store no longer exists joins to no customer,
# so its promotion is left out; the counts are low until those links are
# repaired.


_OFFLINE_SUFFIX = "_offline"


# ============================================================
# INPUTS (read by promo_recalc, one customer at a time)
# ============================================================


def _offline_retailers(conn: Connection, customer_id: int | None = None) -> dict[int, list[int]]:
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
                AND (
                    CAST(:customer_id AS integer) IS NULL
                    OR cr.customer_id = CAST(:customer_id AS integer)
                )
            """
        ),
        {"suffix": _OFFLINE_SUFFIX, "customer_id": customer_id},
    ).mappings().all()

    by_customer: dict[int, list[int]] = {}
    for row in rows:
        by_customer.setdefault(row["customer_id"], []).append(row["retailer_id"])
    return by_customer


def _offline_promotions(conn: Connection, customer_id: int | None = None) -> list[dict]:
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
                AND (
                    CAST(:customer_id AS integer) IS NULL
                    OR cr.customer_id = CAST(:customer_id AS integer)
                )
            """
        ),
        {"suffix": _OFFLINE_SUFFIX, "customer_id": customer_id},
    ).mappings().all()
    return [dict(row) for row in rows]


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


def _last_complete_month(data_through: date | None) -> date | None:
    # The latest month whose sales are all in: data_through's own month only
    # when it reaches that month's last day.
    if data_through is None:
        return None
    month = data_through.replace(day=1)
    if data_through.day == monthrange(data_through.year, data_through.month)[1]:
        return month
    index = month.year * 12 + month.month - 2
    return date(index // 12, index % 12 + 1, 1)


def customer_inputs(conn: Connection, customer_id: int) -> dict:
    """
    One customer's offline promotions, complete monthly units per SKU
    ({(customer_id, sku): {month: units}}, as find_moments takes them) and
    the latest month with complete sales (planned moments come after it).
    """

    retailer_ids = _offline_retailers(conn, customer_id).get(customer_id, [])
    by_sku, data_through = sellout_units.get_monthly_sellout(retailer_ids, conn)
    complete = _complete_units(by_sku, data_through)
    return {
        "promotions": _offline_promotions(conn, customer_id),
        "units": {(customer_id, sku): months for sku, months in complete.items()},
        "sales_through": _last_complete_month(data_through),
    }


def _products(conn: Connection) -> dict[str, dict]:
    rows = conn.execute(text("SELECT sku, product_name, sku_range FROM skus")).mappings().all()
    return {row["sku"]: dict(row) for row in rows}


def sku_ranges(conn: Connection) -> dict[str, str | None]:
    return {sku: product.get("sku_range") for sku, product in _products(conn).items()}


# ============================================================
# READS (from the worked-out tables, migration 020)
# ============================================================


def _customer_names(conn: Connection) -> dict[int, str]:
    rows = conn.execute(text("SELECT customer_id, customer_name FROM customers")).mappings().all()
    return {row["customer_id"]: row["customer_name"] for row in rows}


def _float(value) -> float | None:
    return float(value) if value is not None else None


def _calculated_moments(conn: Connection) -> list[dict]:
    """Every real (not planned) moment as promo_recalc measured it, oldest first per customer x SKU."""

    rows = conn.execute(
        text(
            """
            SELECT
                customer_id,
                sku,
                month,
                promotion_id,
                mechanic_key,
                mechanic_label,
                units,
                anchor_id,
                version_from,
                baseline_mechanic_key,
                baseline_units,
                baseline_source,
                baseline_months,
                is_baseline,
                uplift_pct

            FROM promo_moment_calc

            WHERE
                NOT planned

            ORDER BY
                customer_id,
                sku,
                month
            """
        )
    ).mappings().all()

    return [
        {
            **dict(row),
            "units": _float(row["units"]),
            "baseline_units": _float(row["baseline_units"]),
            "uplift_pct": _float(row["uplift_pct"]),
            "baseline_months": list(row["baseline_months"] or []),
        }
        for row in rows
    ]


def calc_status(conn: Connection) -> dict[int, dict]:
    """
    Per customer: when its moments and uplifts were last worked out, whether a
    recalculation is waiting (`pending`), and the last error or warnings.
    """

    rows = conn.execute(
        text(
            """
            SELECT
                c.customer_id,
                status.calculated_at,
                status.warnings,
                status.last_error,
                status.last_error_at,
                EXISTS (
                    SELECT 1
                    FROM promo_recalc_requests request
                    WHERE
                        request.processed_at IS NULL
                        AND (request.customer_id IS NULL OR request.customer_id = c.customer_id)
                ) AS pending

            FROM customers c
            LEFT JOIN promo_calc_status status
                ON status.customer_id = c.customer_id
            """
        )
    ).mappings().all()

    return {
        row["customer_id"]: {
            "calculated_at": common.iso(row["calculated_at"]),
            "pending": row["pending"],
            "warnings": row["warnings"] or [],
            "last_error": row["last_error"],
            "last_error_at": common.iso(row["last_error_at"]),
        }
        for row in rows
    }


def _named(row: dict, customers: dict[int, str], products: dict[str, dict]) -> dict:
    product = products.get(row["sku"], {})
    return {
        **row,
        "customer_name": customers.get(row["customer_id"]),
        "product_name": product.get("product_name"),
        "sku_range": product.get("sku_range"),
    }


def anchor_recommendations(conn: Connection) -> dict[tuple[int, str | None], dict]:
    """The recommended anchor per customer x SKU range and per customer (promo_moment_rules.recommend_anchors)."""

    return rules.recommend_anchors(_calculated_moments(conn), sku_ranges(conn))


def list_moments() -> dict:
    """
    Every offline moment with its uplift measured against the anchor version
    of its own month, the Recommended Uplift per customer x SKU x mechanic
    (average of the latest moments), and each customer's calculation status.
    """

    with common.read_connection() as conn:
        measured = _calculated_moments(conn)
        products = _products(conn)
        customers = _customer_names(conn)
        status = calc_status(conn)

    recommendations = rules.recommend(measured)

    return {
        "baseline_method": rules.BASELINE_METHOD,
        "recommend_from": rules.RECOMMEND_FROM,
        "moments": [
            {
                **_named(moment, customers, products),
                "month": moment["month"].isoformat(),
                "version_from": moment["version_from"].isoformat() if moment["version_from"] else None,
                "baseline_months": [month.isoformat() for month in moment["baseline_months"]],
            }
            for moment in measured
        ],
        "recommendations": [_named(row, customers, products) for row in recommendations],
        "calc_status": {str(customer_id): item for customer_id, item in status.items()},
    }
