import json
from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.settings import common
from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_moments
from app.services.settings import promo_uplift_rules as uplift_rules
from app.services.settings import promo_uplifts


# The worked-out uplifts on Promotion Uplift Settings: one row per customer x
# SKU range x mechanic, holding each anchor version from this month on and,
# inside it, every SKU of the range with its level, value and explanation.
# Read from promo_uplift_calc (promo_recalc writes it); a SKU x mechanic with
# no moments has no saved row, so its value is the placeholder rule against
# that version's anchor, worked out here in the same shape choose_uplift
# saves. Nothing is calculated from sell-out on a page load.


# How direct a level is, most direct first: a range row takes its SKUs'
# least direct level, so it never reads better than its weakest SKU.
LEVEL_ORDER = (
    versions.ANCHOR,
    versions.MEASURED,
    versions.MEASURED_EARLIER,
    versions.PLACEHOLDER,
    versions.UNAVAILABLE,
)


# ============================================================
# READS
# ============================================================


def _calc_rows(conn: Connection, customer_id: int | None) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                customer_id,
                sku,
                mechanic_key,
                anchor_id,
                version_from,
                level,
                uplift_pct,
                explanation

            FROM promo_uplift_calc

            WHERE
                CAST(:customer_id AS integer) IS NULL
                OR customer_id = CAST(:customer_id AS integer)
            """
        ),
        {"customer_id": customer_id},
    ).mappings().all()

    return [
        {
            **dict(row),
            "uplift_pct": float(row["uplift_pct"]) if row["uplift_pct"] is not None else None,
            # pg8000 returns JSONB already parsed; a fake may hand over text.
            "explanation": json.loads(row["explanation"]) if isinstance(row["explanation"], str) else row["explanation"],
        }
        for row in rows
    ]


# ============================================================
# PURE: the rows the page shows
# ============================================================


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else value


def _version_key(version: dict) -> tuple:
    return (version["version_id"], version["anchor_pct"], version["mechanic_key"])


def _target_versions(anchor_for, customer_id: int, sku_range: str, months: list[date]) -> list[tuple[date, dict]]:
    """The versions a customer x range has from this month on: (first month, version), a new entry only on a change."""

    changes = []
    for month in months:
        version = anchor_for(customer_id, sku_range, month)
        if not changes or _version_key(changes[-1][1]) != _version_key(version):
            changes.append((month, version))
    return changes


def _worked_out(mechanic_key: str, version: dict, anchor_key: str | None, discount) -> dict:
    """A SKU x mechanic with no saved row: the anchor itself, else the placeholder rule, else unavailable."""

    result = {
        "mechanic_key": mechanic_key,
        "anchor": {
            "version_id": version["version_id"],
            "effective_from": _iso(version["effective_from"]),
            "mechanic_key": anchor_key,
            "anchor_pct": float(version["anchor_pct"]),
        },
        "moments": [],
        "placeholder": None,
    }
    if anchor_key is not None and mechanic_key == anchor_key:
        return {**result, "level": versions.ANCHOR, "uplift_pct": 0.0}
    if discount is None:
        return {**result, "level": versions.UNAVAILABLE, "uplift_pct": None}
    return {
        **result,
        "level": versions.PLACEHOLDER,
        "uplift_pct": float(uplift_rules.placeholder_uplift(Decimal(discount), version["anchor_pct"])),
        "placeholder": {"discount_pct": float(discount), "anchor_pct": float(version["anchor_pct"])},
    }


def _saved(row: dict) -> dict:
    explanation = row["explanation"] or {}
    return {
        "mechanic_key": row["mechanic_key"],
        "level": row["level"],
        "uplift_pct": row["uplift_pct"],
        "anchor": explanation.get("anchor"),
        "moments": explanation.get("moments") or [],
        "placeholder": explanation.get("placeholder"),
    }


def _range_summary(skus: list[dict]) -> dict:
    values = [sku["uplift_pct"] for sku in skus if sku["uplift_pct"] is not None]
    levels = [sku["level"] for sku in skus]
    return {
        "level": max(levels, key=LEVEL_ORDER.index) if levels else versions.UNAVAILABLE,
        "uplift_min": min(values) if values else None,
        "uplift_max": max(values) if values else None,
        "levels": {level: levels.count(level) for level in LEVEL_ORDER if level in levels},
    }


def calculated_rows(
    calc_rows: list[dict],
    customers: list[dict],
    products: dict[str, dict],
    mechanics: dict[str, dict],
    anchor_for,
    months: list[date],
) -> list[dict]:
    """
    One row per customer x SKU range x mechanic (`mechanics`: {key: {label,
    discount_pct}}), each with its anchor versions from `months[0]` on
    (`months`: this month and every later month a version starts) and, per
    version, every SKU of the range: the saved value when promo_recalc
    worked one out, else _worked_out. A version's level is its SKUs' least
    direct one; uplift_min / uplift_max show when its SKUs differ.
    """

    saved = {(row["customer_id"], row["sku"], row["mechanic_key"], row["anchor_id"]): row for row in calc_rows}
    # A version with no anchor saved measures against the mechanic its
    # moments ran most often (promo_anchor_versions._anchor_key); the saved
    # rows say which it was.
    unsaved_anchor_keys = {
        (row["customer_id"], row["sku"]): (row["explanation"] or {}).get("anchor", {}).get("mechanic_key")
        for row in calc_rows
        if row["anchor_id"] is None
    }

    by_range: dict[str, list[dict]] = {}
    for sku, product in sorted(products.items()):
        if product.get("sku_range"):
            by_range.setdefault(product["sku_range"], []).append({"sku": sku, "product_name": product.get("product_name")})

    rows = []
    for customer in customers:
        customer_id = customer["customer_id"]
        for sku_range, range_skus in sorted(by_range.items()):
            target_versions = _target_versions(anchor_for, customer_id, sku_range, months)
            for mechanic_key, mechanic in sorted(mechanics.items(), key=lambda item: item[1]["label"]):
                row_versions = []
                for start, version in target_versions:
                    skus = []
                    for item in range_skus:
                        row = saved.get((customer_id, item["sku"], mechanic_key, version["version_id"]))
                        if row is not None:
                            value = _saved(row)
                        else:
                            anchor_key = version["mechanic_key"]
                            if version["version_id"] is None:
                                anchor_key = unsaved_anchor_keys.get((customer_id, item["sku"]))
                            value = _worked_out(mechanic_key, version, anchor_key, mechanic.get("discount_pct"))
                        skus.append({**item, **value})
                    row_versions.append({
                        "effective_from": start.isoformat(),
                        "anchor": {
                            "version_id": version["version_id"],
                            "mechanic_label": version["mechanic_label"],
                            "anchor_pct": float(version["anchor_pct"]),
                            "effective_from": _iso(version["effective_from"]),
                        },
                        **_range_summary(skus),
                        "skus": skus,
                    })
                rows.append({
                    "customer_id": customer_id,
                    "customer_name": customer["customer_name"],
                    "sku_range": sku_range,
                    "mechanic_key": mechanic_key,
                    "mechanic_label": mechanic["label"],
                    "discount_pct": float(mechanic["discount_pct"]) if mechanic.get("discount_pct") is not None else None,
                    "versions": row_versions,
                })
    return rows


# ============================================================
# THE ENDPOINT'S READ
# ============================================================


def list_calculated(customer_id: int | None = None) -> dict:
    """
    The worked-out uplift per customer x SKU range x mechanic, with its
    anchor versions and SKUs (calculated_rows), and each customer's
    calculation status. One customer when `customer_id` is given.
    """

    with common.read_connection() as conn:
        customers = promo_uplifts._customers(conn, customer_id)
        calc_rows = _calc_rows(conn, customer_id)
        products = promo_moments._products(conn)
        mechanics = promo_uplifts.mechanic_discounts(conn)
        anchor_rows = promo_uplifts._anchor_rows(conn)
        status = promo_moments.calc_status(conn)

    this_month = common.this_month()
    later = sorted({row["effective_from"] for row in anchor_rows if row["effective_from"] and row["effective_from"] > this_month})

    return {
        "rows": calculated_rows(
            calc_rows,
            customers,
            products,
            mechanics,
            versions.version_lookup(anchor_rows),
            [this_month, *later],
        ),
        "calc_status": {
            str(item["customer_id"]): status.get(item["customer_id"], {})
            for item in customers
        },
    }
