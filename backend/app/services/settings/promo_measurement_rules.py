import calendar
import hashlib
import json
from datetime import date
from statistics import median

from app.services.settings.promo_uplift_rules import VOUCHER_KEY, active_by_store_day


# Pure maths behind the promotion uplift measurement (Promotions Uplift
# design, Section 7; plan in docs/forecasting.md, Part E). No database here;
# promo_measurement.py feeds these the rows it reads. Percentages are plain
# floats in percent (4.0 means +4%).
#
# In one paragraph: each SKU's monthly sales are compared with its own trend
# line, so growth isn't mistaken for a promotion effect. Each month records
# how much of it every mechanic covered (its "exposure": share of days x
# share of the customer's usual promotion reach). A small least-squares fit
# then shares each month's rise or fall out between the mechanics that ran
# in it. Then the chain of uplifts: a SKU's own uplift leans on the blended
# customer uplift, and the customer's own uplift on the rule-based uplift,
# each more strongly while its evidence is thin.


# Keeps the least-squares fit solvable when two mechanics always run
# together (they then share the effect equally). Relative to each
# mechanic's own exposure, so it barely moves a well-identified uplift.
_RIDGE = 0.001


def days_in_month(month: date) -> int:
    return calendar.monthrange(month.year, month.month)[1]


def _month_index(month: date) -> int:
    return month.year * 12 + month.month - 1


# ============================================================
# STORE WEIGHTS AND EXPOSURE
# ============================================================


def store_weights(units_by_store: dict, all_stores) -> dict:
    """
    Each store's share of a SKU's sales. With no sales at all, every store of
    the customer counts the same (so a promotion's reach falls back to its
    share of stores).
    """

    total = sum(max(units or 0, 0) for units in units_by_store.values())
    if total > 0:
        return {store: max(units or 0, 0) / total for store, units in units_by_store.items()}
    stores = list(all_stores)
    return {store: 1 / len(stores) for store in stores} if stores else {}


def exposures(promotions: list[dict], discount_by_key: dict, weights: dict, months) -> dict[date, dict[str, float]]:
    """
    Raw exposure per month and mechanic: the share of the month's store-days,
    weighted by each store's sales, that each discount mechanic ran (a side
    offer replaces the monthly promotion on its days). The voucher gets its
    own entry: store-days covered by any promotion carrying a voucher.
    `promotions` are one SKU's, each with stores, period_start, period_end,
    promo_type, mechanic_key and voucher (0/1).
    """

    wanted = set(months)
    result: dict[date, dict[str, float]] = {month: {} for month in wanted}

    for (store, day), (key, _discount) in active_by_store_day(promotions, discount_by_key).items():
        month = day.replace(day=1)
        if month in wanted:
            share = weights.get(store, 0) / days_in_month(month)
            result[month][key] = result[month].get(key, 0.0) + share

    voucher_days = set()
    for promotion in promotions:
        if not promotion.get("voucher"):
            continue
        day = promotion["period_start"]
        while day <= promotion["period_end"]:
            if day.replace(day=1) in wanted:
                for store in promotion.get("stores") or (None,):
                    voucher_days.add((store, day))
            day = date.fromordinal(day.toordinal() + 1)
    for store, day in voucher_days:
        month = day.replace(day=1)
        result[month][VOUCHER_KEY] = result[month].get(VOUCHER_KEY, 0.0) + weights.get(store, 0) / days_in_month(month)

    return result


def usual_reach(rows: list[dict[str, float]]) -> float:
    """
    How much of a customer's sales an ordinary promotion month reaches: the
    median total discount exposure over SKU-months that had any. 1.0 when
    there is nothing to go on. Fairprice runs offline only, so about 0.67.
    """

    totals = [sum(v for k, v in row.items() if k != VOUCHER_KEY) for row in rows]
    totals = [total for total in totals if total > 0]
    return median(totals) if totals else 1.0


def relative(raw: dict[str, float], reach: float) -> dict[str, float]:
    """Exposure as a share of the customer's usual reach, capped at a full month."""

    if reach <= 0:
        return {}
    return {key: min(1.0, value / reach) for key, value in raw.items() if value > 0}


# ============================================================
# TREND
# ============================================================


def trend_ratios(units_by_month: dict[date, float], min_months: int) -> tuple[dict[date, float], str]:
    """
    Each month's sales divided by the SKU's straight trend line ('trend'),
    or by its average when there are fewer than min_months months or the
    line drops to zero or below ('flat'). Empty when there is no sale at all.
    """

    months = sorted(units_by_month)
    values = [float(units_by_month[month]) for month in months]
    if not months:
        return {}, "flat"

    if len(months) >= min_months:
        xs = [_month_index(month) for month in months]
        x_mean = sum(xs) / len(xs)
        y_mean = sum(values) / len(values)
        spread = sum((x - x_mean) ** 2 for x in xs)
        slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, values)) / spread if spread else 0.0
        fitted = [y_mean + slope * (x - x_mean) for x in xs]
        if all(value > 0 for value in fitted):
            return {month: value / fit for month, value, fit in zip(months, values, fitted)}, "trend"

    mean = sum(values) / len(values)
    if mean <= 0:
        return {}, "flat"
    return {month: value / mean for month, value in zip(months, values)}, "flat"


# ============================================================
# SHARING EACH MONTH'S EFFECT BETWEEN MECHANICS
# ============================================================


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    # Gaussian elimination with partial pivoting; the matrix is small and
    # positive definite (ridge on the diagonal).
    size = len(vector)
    rows = [matrix[i][:] + [vector[i]] for i in range(size)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda r: abs(rows[r][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        if rows[col][col] == 0:
            continue
        for r in range(size):
            if r != col and rows[r][col] != 0:
                factor = rows[r][col] / rows[col][col]
                rows[r] = [a - factor * b for a, b in zip(rows[r], rows[col])]
    return [rows[i][size] / rows[i][i] if rows[i][i] else 0.0 for i in range(size)]


def fit_uplifts(ratios: dict[date, float], exposure: dict[date, dict[str, float]], min_exposure: float) -> dict[str, dict]:
    """
    One SKU's own uplift per mechanic (and voucher), in percent.

    y (each month's rise above the SKU's average month) = sum over the
    mechanics that ran of exposure x uplift, fitted by least squares over
    the months. A mechanic counts in a month only from min_exposure, and only
    when the SKU has months both with and without it (contrast): if every
    month ran it, its effect can't be told apart from an ordinary month.

    Returns {key: {"uplift_pct", "n" (months of evidence = summed exposure),
    "months" (the months it counted in)}}.
    """

    months = sorted(ratios)
    if not months:
        return {}
    base = sum(ratios.values()) / len(months)
    y = {month: ratios[month] / base - 1 for month in months}

    counted = {
        month: {key: value for key, value in exposure.get(month, {}).items() if value >= min_exposure}
        for month in months
    }
    months_with: dict[str, list[date]] = {}
    for month in months:
        for key in counted[month]:
            months_with.setdefault(key, []).append(month)
    keys = sorted(key for key, with_it in months_with.items() if len(with_it) < len(months))
    if not keys:
        return {}

    gram = [[sum(counted[m].get(a, 0) * counted[m].get(b, 0) for m in months) for b in keys] for a in keys]
    for i in range(len(keys)):
        gram[i][i] *= 1 + _RIDGE
    target = [sum(counted[m].get(key, 0) * y[m] for m in months) for key in keys]
    solution = _solve(gram, target)

    return {
        key: {
            "uplift_pct": solution[i] * 100,
            "n": sum(counted[m][key] for m in months_with[key]),
            "months": months_with[key],
        }
        for i, key in enumerate(keys)
    }


# ============================================================
# BLENDING (SHRINKAGE)
#
# rule-based uplift -> blended customer uplift -> blended SKU uplift: each
# level leans on the one above while its own evidence is thin. The starting
# weight (k) says how many months of evidence the level above counts as.
# ============================================================


def blended_customer_uplift(
    sku_results: list[dict],
    big_n: float,
    rule_based_pct: float,
    starting_weight: float,
) -> tuple[float | None, float]:
    """
    (customer's own uplift, blended customer uplift) for one mechanic.
    Customer's own uplift = the SKUs' own uplifts weighted by each SKU's
    sales volume; blended = (N x own + k x rule-based) / (N + k), N = the
    customer's months of evidence. With no SKU evidence: (None, rule-based).
    """

    usable = [r for r in sku_results if r["n"] > 0 and r["volume"] > 0]
    if not usable or big_n <= 0:
        return None, rule_based_pct
    own = sum(r["uplift_pct"] * r["volume"] for r in usable) / sum(r["volume"] for r in usable)
    return own, (big_n * own + starting_weight * rule_based_pct) / (big_n + starting_weight)


def blended_sku_uplift(sku_own_pct: float, n: float, blended_customer_pct: float, starting_weight: float) -> float:
    """Blended SKU uplift: (n x SKU's own uplift + k x blended customer uplift) / (n + k)."""

    return (n * sku_own_pct + starting_weight * blended_customer_pct) / (n + starting_weight)


# ============================================================
# BACKTEST CHECK
# ============================================================


def backtest_check(errors_by_month: dict[date, float], exposure_by_month: dict[date, float]) -> tuple[float | None, float]:
    """
    (average error %, months of evidence) over backtest months where the
    mechanic counted, weighted by its exposure. errors are (actual - forecast)
    / forecast x 100 from a forecast that knew nothing about promotions.
    (None, 0) when no backtest month had it.
    """

    pairs = [(exposure_by_month[m], errors_by_month[m]) for m in exposure_by_month if m in errors_by_month]
    weight = sum(e for e, _ in pairs)
    if weight <= 0:
        return None, 0.0
    return sum(e * err for e, err in pairs) / weight, weight


def disagrees(value_pct: float, check_pct: float | None, tolerance: float) -> bool:
    """True when the backtest points the other way, both by at least `tolerance` points."""

    if check_pct is None:
        return False
    if abs(value_pct) < tolerance or abs(check_pct) < tolerance:
        return False
    return (value_pct > 0) != (check_pct > 0)


# ============================================================
# FINGERPRINT
# ============================================================


def fingerprint(payload) -> str:
    """A stable hash of every input, so the same inputs never write twice."""

    text = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
