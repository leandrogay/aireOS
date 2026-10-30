"""Estimated promotion prices; original sell-out revenue is never changed."""

import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache

from sqlalchemy import text

from app.services import sql


_BUY_GET_FREE = re.compile(r"buy\s+(\d+)\s+get\s+(\d+)\s+free", re.I)
_BUY_GET_PERCENT = re.compile(r"buy\s+(\d+)\s+get\s+(\d+(?:\.\d+)?)\s*%\s*(?:off|free)?", re.I)
_PERCENT_OFF = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*off", re.I)
_VOUCHER = re.compile(r"\$\s*(\d+(?:\.\d+)?)\s*off\s*\$\s*(\d+(?:\.\d+)?)", re.I)


def mechanic_multiplier(value: str | None) -> Decimal | None:
    """Return the estimated paid share per unit, or None for unknown text."""
    text = (value or "").strip()
    if not text or text.casefold() in {"no promo", "voucher"}:
        return Decimal(1)

    match = _BUY_GET_FREE.fullmatch(text)
    if match:
        bought, free = map(Decimal, match.groups())
        if bought > 0 and free > 0:
            return bought / (bought + free)
        return None

    match = _BUY_GET_PERCENT.fullmatch(text)
    if match:
        bought, percent = map(Decimal, match.groups())
        if bought > 0 and 0 < percent <= 100:
            return (bought - percent / 100) / bought
        return None

    match = _PERCENT_OFF.fullmatch(text)
    if match:
        percent = Decimal(match.group(1))
        if 0 < percent <= 100:
            return 1 - percent / 100
    return None


def voucher_multiplier(value: str | None) -> Decimal | None:
    """Assume every unit shares the voucher's face-value/threshold discount."""
    if not value or not value.strip():
        return Decimal(1)
    match = _VOUCHER.fullmatch(value.strip())
    if not match:
        return None
    amount, threshold = map(Decimal, match.groups())
    if threshold <= 0 or amount < 0 or amount > threshold:
        return None
    return 1 - amount / threshold


def estimate_unit_price(
    catalog_price: Decimal,
    promotion_mechanic: str | None,
    voucher: str | None,
) -> Decimal | None:
    """Apply the mechanic first, then the assumed stacked voucher discount."""
    mechanic = mechanic_multiplier(promotion_mechanic)
    voucher_rate = voucher_multiplier(voucher)
    if catalog_price < 0 or mechanic is None or voucher_rate is None:
        return None
    return catalog_price * mechanic * voucher_rate


def _price_on_day(
    versions: list[dict],
    day: date,
    current_price: Decimal | None,
) -> tuple[Decimal | None, bool]:
    """Return the effective history snapshot and whether it predates history."""
    prior = [
        version for version in versions
        if version["changed_at"].date() <= day
    ]
    if prior:
        selected = prior[-1]
        return (
            None if selected["action"] == "archived" else selected["price"],
            False,
        )
    if versions:
        first = versions[0]
        return (
            None if first["action"] == "archived" else first["price"],
            True,
        )
    return current_price, current_price is not None


def _promotion_on_day(
    promotions: list[dict],
    row: dict,
    day: date,
) -> tuple[dict | None, bool]:
    applicable = [
        promo for promo in promotions
        if promo["sku"] == row["sku"]
        and promo["retailer_id"] == row["retailer_id"]
        and promo["store_code"] == row["store_code"]
        and promo["period_start"] <= day <= promo["period_end"]
        and not promo["promo_type"].startswith("carton_")
        and "carton" not in (promo["promotion_mechanic"] or "").casefold()
    ]
    if not applicable:
        return None, False
    # The calendars explicitly say that a weekly side offer overrides a
    # monthly promotion. Other overlaps need human review.
    priority = {"side_offer": 0, "monthly": 1, "bundle": 2, "others": 3}
    best = min(priority.get(promo["promo_type"], 4) for promo in applicable)
    best_promos = [
        promo for promo in applicable
        if priority.get(promo["promo_type"], 4) == best
    ]
    mechanics = {
        promo["promotion_mechanic"]
        for promo in best_promos
        if (promo["promotion_mechanic"] or "").casefold() != "voucher"
    }
    vouchers = {promo["voucher"] for promo in best_promos if promo["voucher"]}
    if len(mechanics) > 1 or len(vouchers) > 1:
        return None, True
    chosen = next(
        (promo for promo in best_promos
         if (promo["promotion_mechanic"] or "").casefold() != "voucher"),
        best_promos[0],
    )
    voucher = next(iter(vouchers), None)
    voucher_source = (
        next((promo for promo in best_promos if promo["voucher"] == voucher), None)
        if voucher else None
    )

    if best == priority["side_offer"] and not voucher:
        monthly = [promo for promo in applicable if promo["promo_type"] == "monthly" and promo["voucher"]]
        monthly_vouchers = {promo["voucher"] for promo in monthly}
        if len(monthly_vouchers) > 1:
            return None, True
        if monthly:
            voucher = monthly[0]["voucher"]
            voucher_source = monthly[0]

    return {
        **chosen,
        "voucher": voucher,
        "stacked_voucher_promotion_id": (
            voucher_source["promotion_id"]
            if voucher_source and voucher_source["promotion_id"] != chosen["promotion_id"]
            else None
        ),
    }, False


def estimate_sales_row(
    row: dict,
    price_versions: dict[str, list[dict]],
    current_prices: dict[str, Decimal],
    promotions: list[dict],
) -> dict:
    """Estimate a row's revenue without replacing its original revenue."""
    result = {
        **row,
        "estimated_revenue": None,
        "list_price_revenue": None,
        "effective_multiplier": None,
        "estimated_discount_percent": None,
        "revenue_source": "actual" if row.get("revenue") is not None else "unavailable",
        "promotion_ids": [],
        "price_assumed_before_history": False,
        "pricing_issue": None,
    }
    if row.get("revenue") is not None:
        return result
    if row.get("quantity_units") is None:
        result["pricing_issue"] = "Quantity is missing."
        return result
    if row["quantity_units"] < 0:
        result["pricing_issue"] = "Negative units cannot be estimated."
        return result

    first, last = row["period_start"], row["period_end"]
    days = (last - first).days + 1
    daily_quantity = Decimal(str(row["quantity_units"])) / days
    total = Decimal(0)
    list_price_total = Decimal(0)
    promo_ids = set()

    for offset in range(days):
        day = first + timedelta(days=offset)
        price, assumed = _price_on_day(
            price_versions.get(row["sku"], []), day, current_prices.get(row["sku"]),
        )
        if price is None:
            result["pricing_issue"] = f"No SKU price is available for {day}."
            return result
        result["price_assumed_before_history"] |= assumed
        promo, ambiguous = _promotion_on_day(promotions, row, day)
        if ambiguous:
            result["pricing_issue"] = f"Overlapping promotions need review on {day}."
            return result
        unit_price = estimate_unit_price(
            price,
            promo["promotion_mechanic"] if promo else None,
            promo["voucher"] if promo else None,
        )
        if unit_price is None:
            result["pricing_issue"] = f"Unrecognised promotion terms on {day}."
            return result
        total += daily_quantity * unit_price
        list_price_total += daily_quantity * price
        if promo:
            promo_ids.add(promo["promotion_id"])
            if promo["stacked_voucher_promotion_id"] is not None:
                promo_ids.add(promo["stacked_voucher_promotion_id"])

    result["estimated_revenue"] = float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    result["list_price_revenue"] = float(list_price_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if list_price_total:
        multiplier = total / list_price_total
        result["effective_multiplier"] = float(multiplier.quantize(Decimal("0.000001")))
        result["estimated_discount_percent"] = float(
            ((1 - multiplier) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        )
    result["revenue_source"] = "estimated"
    result["promotion_ids"] = sorted(promo_ids)
    return result


@lru_cache(maxsize=1)
def _get_read_engine():
    return sql.connect_with_connector_autocommit()


def estimate_sales_revenue(rows: list[dict]) -> list[dict]:
    """Price sales rows in one read batch using SKU history and linked promos."""
    if not rows:
        return []
    missing = [row for row in rows if row.get("revenue") is None]
    if not missing:
        return [estimate_sales_row(row, {}, {}, []) for row in rows]

    sku_codes = sorted({row["sku"] for row in missing})
    retailer_ids = sorted({row["retailer_id"] for row in missing})
    first = min(row["period_start"] for row in missing)
    last = max(row["period_end"] for row in missing)
    params = {"skus": sku_codes, "retailer_ids": retailer_ids,
              "period_start": first, "period_end": last}

    with _get_read_engine().connect() as conn:
        current_rows = conn.execute(text("""
            SELECT sku, price FROM skus
            WHERE sku = ANY(CAST(:skus AS text[])) AND price IS NOT NULL
              AND is_active = TRUE
        """), params).mappings().all()
        history_rows = conn.execute(text("""
            SELECT sku, action, price, changed_at
            FROM sku_history
            WHERE sku = ANY(CAST(:skus AS text[]))
            ORDER BY sku, changed_at, sku_history_id
        """), params).mappings().all()
        promotion_rows = conn.execute(text("""
            SELECT p.promotion_id, p.period_start, p.period_end, p.promo_type,
                   p.promotion_mechanic, p.voucher, ps.sku,
                   s.retailer_id, s.store_code
            FROM promotions p
            JOIN promotion_skus ps ON ps.promotion_id = p.promotion_id
            JOIN promotion_stores pst ON pst.promotion_id = p.promotion_id
            JOIN stores s ON s.store_id = pst.store_id
            WHERE ps.sku = ANY(CAST(:skus AS text[]))
              AND s.retailer_id = ANY(CAST(:retailer_ids AS integer[]))
              AND p.period_start <= :period_end
              AND p.period_end >= :period_start
        """), params).mappings().all()

    current_prices = {item["sku"]: Decimal(str(item["price"])) for item in current_rows}
    versions: dict[str, list[dict]] = {}
    for item in history_rows:
        versions.setdefault(item["sku"], []).append({
            "action": item["action"],
            "price": Decimal(str(item["price"])) if item["price"] is not None else None,
            "changed_at": item["changed_at"],
        })
    return [
        estimate_sales_row(row, versions, current_prices, list(promotion_rows))
        for row in rows
    ]
