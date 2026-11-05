from calendar import monthrange
from datetime import date
from statistics import mean

from app.services.settings import promo_uplift_rules as rules


# Pure rules behind the Recommended Uplift on Promotion Uplift Settings: which
# months are "moments" (a promotion whose own uplift can be measured), what
# each moment is measured against, and the recommendation from the latest
# moments. No database here; promo_moments.py feeds these the rows it reads.
#
# Sell-out is monthly, so a moment is a whole customer x SKU x month:
#   - exactly one promotion touches that customer's offline stores for the
#     SKU in the month, and it is a monthly promotion running the whole month
#     (a side offer always sits inside a monthly promotion, so it can never be
#     told apart from it with monthly sales);
#   - its mechanic is readable and is not a bare "Voucher" (vouchers matter
#     online; only offline is measured, so a voucher on top is ignored);
#   - the month's sales are loaded and complete.
#
# Baseline: the customer x SKU range's anchor, the mechanic it most often
# runs as a moment (its ordinary month; size does not matter, so the SKUs of
# a range share it). Anchors are saved once and only change when someone
# adopts a newer recommendation (promo_uplifts), so the baseline does not
# drift; recommend_anchors gives that recommendation, counted by mechanic
# over the last ANCHOR_WINDOW_MONTHS months. A moment's uplift is its units
# against the average of the same SKU's months at the anchor mechanic, since
# SKUs in a range sell different volumes. The preferred baseline (no-discount
# months last year x that year's growth) needs months with no promotion,
# which the data does not have yet; it is added here once it does.


# ============================================================
# Constants
# ============================================================

BASELINE_METHOD = "common_discount"

# The recommendation averages the latest RECOMMEND_FROM moments. With fewer
# there is no recommendation: the user keys in a Manual Uplift instead.
RECOMMEND_FROM = 3

# The recommended anchor counts this many months up to the latest moment, so
# a shift in what a customer usually runs shows within a year.
ANCHOR_WINDOW_MONTHS = 12

_MONTHLY_TYPE = "monthly"


# ============================================================
# MOMENTS
# ============================================================


def _month_end(month: date) -> date:
    return month.replace(day=monthrange(month.year, month.month)[1])


def _months(start: date, end: date):
    month = start.replace(day=1)
    while month <= end:
        yield month
        month = date(month.year + month.month // 12, month.month % 12 + 1, 1)


def _whole_month_monthly(promotion: dict, month: date) -> bool:
    # carton_monthly is a monthly promotion for a different pack.
    promo_type = (promotion.get("promo_type") or "").removeprefix("carton_")
    return (
        promo_type == _MONTHLY_TYPE
        and promotion["period_start"] <= month
        and promotion["period_end"] >= _month_end(month)
    )


def find_moments(promotions: list[dict], units: dict[tuple[int, str], dict[date, float]]) -> list[dict]:
    """
    Every moment, oldest first. Each promotion row is one promotion on one
    customer's offline stores for one SKU (customer_id, sku, promotion_id,
    period_start, period_end, promo_type, promotion_mechanic); units maps
    (customer_id, sku) to {first of month: units} for complete months only.
    """

    touching: dict[tuple[int, str, date], list[dict]] = {}
    for promotion in promotions:
        for month in _months(promotion["period_start"], promotion["period_end"]):
            key = (promotion["customer_id"], promotion["sku"], month)
            touching.setdefault(key, []).append(promotion)

    moments = []
    for (customer_id, sku, month), month_promotions in sorted(touching.items()):
        if len({row["promotion_id"] for row in month_promotions}) != 1:
            continue

        promotion = month_promotions[0]
        key = rules.mechanic_key(promotion.get("promotion_mechanic"))
        sold = units.get((customer_id, sku), {}).get(month)
        if key in (None, rules.VOUCHER_KEY) or sold is None or not _whole_month_monthly(promotion, month):
            continue

        moments.append({
            "customer_id": customer_id,
            "sku": sku,
            "month": month,
            "promotion_id": promotion["promotion_id"],
            "mechanic_key": key,
            "mechanic_label": promotion["promotion_mechanic"],
            "units": float(sold),
        })
    return moments


# ============================================================
# BASELINE AND UPLIFT
# ============================================================


def _baseline_key(moments: list[dict]) -> str:
    # Most moments wins; a tie goes to the mechanic used most recently, then
    # the key, so the choice never depends on row order.
    counts: dict[str, int] = {}
    latest: dict[str, date] = {}
    for moment in moments:
        key = moment["mechanic_key"]
        counts[key] = counts.get(key, 0) + 1
        latest[key] = max(latest.get(key, moment["month"]), moment["month"])
    return max(counts, key=lambda key: (counts[key], latest[key], key))


def measure_moments(
    moments: list[dict],
    sku_ranges: dict[str, str | None] | None = None,
    baselines: dict[tuple[int, str], str | None] | None = None,
) -> list[dict]:
    """
    Each moment with its baseline: baseline_mechanic_key (the customer x
    range's, from `sku_ranges` {sku: sku_range}; a SKU with no range is its
    own group), baseline_units (the SKU's average units at that mechanic,
    None when it has no such month), is_baseline, and uplift_pct (units
    against baseline_units, 2 dp; None without a baseline that sold).

    `baselines` {(customer_id, sku_range): mechanic_key} are the saved
    anchors; None for a group means it has none to measure against (a typed
    discount). A group missing from it uses its most common mechanic.
    """

    sku_ranges = sku_ranges or {}
    baselines = baselines or {}
    by_range: dict[tuple[int, str], list[dict]] = {}
    for moment in moments:
        group = sku_ranges.get(moment["sku"]) or moment["sku"]
        by_range.setdefault((moment["customer_id"], group), []).append(moment)

    measured = []
    for group, range_moments in by_range.items():
        baseline_key = baselines[group] if group in baselines else _baseline_key(range_moments)
        baseline_units: dict[str, float] = {}
        for sku in {m["sku"] for m in range_moments}:
            units = [m["units"] for m in range_moments if m["sku"] == sku and m["mechanic_key"] == baseline_key]
            if units:
                baseline_units[sku] = mean(units)

        for moment in range_moments:
            sku_baseline = baseline_units.get(moment["sku"])
            uplift = None
            if sku_baseline:
                uplift = round((moment["units"] / sku_baseline - 1) * 100, 2)
            measured.append({
                **moment,
                "baseline_mechanic_key": baseline_key,
                "baseline_units": round(sku_baseline, 2) if sku_baseline is not None else None,
                "is_baseline": moment["mechanic_key"] == baseline_key,
                "uplift_pct": uplift,
            })

    return sorted(measured, key=lambda m: (m["customer_id"], m["sku"], m["month"]))


# ============================================================
# RECOMMENDED ANCHOR
# ============================================================


def _months_back(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 - count
    return date(index // 12, index % 12 + 1, 1)


def recommend_anchors(moments: list[dict], sku_ranges: dict[str, str | None]) -> dict[tuple[int, str | None], dict]:
    """
    The recommended anchor per customer x SKU range, and per customer
    (sku_range None): the mechanic with the most months that had a moment
    over the ANCHOR_WINDOW_MONTHS months up to the latest moment, counted
    by mechanic and once per month however many of the range's SKUs it ran
    on. A tie goes to the mechanic used most recently, then the key. With
    fewer than RECOMMEND_FROM months in the window, mechanic_key is None:
    too few to say, so a discount may be typed in instead.
    """

    if not moments:
        return {}

    since = _months_back(max(m["month"] for m in moments), ANCHOR_WINDOW_MONTHS - 1)
    seen: dict[tuple[int, str | None], set[tuple[date, str]]] = {}
    labels: dict[str, str] = {}
    for moment in moments:
        if moment["month"] < since:
            continue
        labels[moment["mechanic_key"]] = moment["mechanic_label"]
        sku_range = sku_ranges.get(moment["sku"])
        targets = [(moment["customer_id"], None)]
        if sku_range:
            targets.append((moment["customer_id"], sku_range))
        for target in targets:
            seen.setdefault(target, set()).add((moment["month"], moment["mechanic_key"]))

    anchors = {}
    for target, pairs in seen.items():
        counts: dict[str, int] = {}
        latest: dict[str, date] = {}
        for month, key in pairs:
            counts[key] = counts.get(key, 0) + 1
            latest[key] = max(latest.get(key, month), month)

        window_months = len({month for month, _ in pairs})
        key = None
        if window_months >= RECOMMEND_FROM:
            key = max(counts, key=lambda k: (counts[k], latest[k], k))
        anchors[target] = {
            "mechanic_key": key,
            "mechanic_label": labels.get(key) if key else None,
            "months": counts.get(key, 0) if key else 0,
            "window_months": window_months,
        }
    return anchors


# ============================================================
# RECOMMENDATION
# ============================================================


def recommend(measured: list[dict]) -> list[dict]:
    """
    One recommendation per customer x SKU x mechanic: the average uplift of
    its latest RECOMMEND_FROM measured moments (None with fewer), with how
    many moments it has (in all and by year) and the months used. The
    baseline mechanic is the ordinary month, so its recommendation is 0 by
    definition.
    """

    groups: dict[tuple[int, str, str], list[dict]] = {}
    for moment in measured:
        key = (moment["customer_id"], moment["sku"], moment["mechanic_key"])
        groups.setdefault(key, []).append(moment)

    recommendations = []
    for (customer_id, sku, mechanic_key), group in sorted(groups.items()):
        by_year: dict[int, int] = {}
        for moment in group:
            by_year[moment["month"].year] = by_year.get(moment["month"].year, 0) + 1

        is_baseline = group[0]["is_baseline"]
        measured_moments = sorted((m for m in group if m["uplift_pct"] is not None), key=lambda m: m["month"])
        enough_data = len(measured_moments) >= RECOMMEND_FROM
        latest = measured_moments[-RECOMMEND_FROM:] if enough_data else []

        if is_baseline:
            recommended = 0.0
        elif enough_data:
            recommended = round(mean(m["uplift_pct"] for m in latest), 2)
        else:
            recommended = None

        recommendations.append({
            "customer_id": customer_id,
            "sku": sku,
            "mechanic_key": mechanic_key,
            "is_baseline": is_baseline,
            "moments": len(group),
            "moments_by_year": dict(sorted(by_year.items())),
            "recommended_uplift_pct": recommended,
            "months_used": [m["month"].isoformat() for m in latest],
            "enough_data": enough_data,
        })
    return recommendations
