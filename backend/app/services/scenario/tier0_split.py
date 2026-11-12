from calendar import monthrange
from datetime import date
from statistics import mean

from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_uplift_rules as uplift_rules


# PURE: Tier 0 split into the ordinary-month baseline (at the anchor) and the
# promotions it carries, for the Scenario builder only. BigQuery's Tier 0 is
# never changed: the Forecast page and the inventory sell-in plan keep last
# year's promotions as they are.
#
# Tier 0 = 0.5 x same month last year + 0.5 x the 3-month run-rate (bigquery
# view fc_tier0_forecasts, pl_forecast). Each of those months carries the
# official promotions that ran in it: every promotion touching the customer's
# offline stores for the SKU in that month, vouchers left out, each at its
# uplift x the share of the month it runs; several in one month add up.
# Taking each month's uplift out gives the baseline:
#
#     baseline = 0.5 x LY / (1 + u_ly) + 0.5 x mean(month / (1 + u_month))
#
# and the carried promotions are Tier 0 - baseline, one block per month
# (never split by promotion). An official or scenario promotion planned for
# the month replaces that block (the frontend's scenarioEngine works that
# out from these parts). scripts/backtest_tier0_promotions.py scored this
# against 2026 actuals.


# ============================================================
# Constants
# ============================================================

# pl_forecast.ForecastParams.ly_weight, the view's ly_weight.
LY_WEIGHT = 0.5

# The run-rate is the months in the 3 months up to the series' latest month.
RUN_RATE_MONTHS = 3

# The view forecasts this many months after the origin.
HORIZON_MONTHS = 15

# Most direct first, as on Promotion uplift settings: a summary shows the
# weakest level among its values.
LEVEL_ORDER = [
    versions.ANCHOR,
    versions.MEASURED,
    versions.MEASURED_EARLIER,
    versions.PLACEHOLDER,
    versions.UNAVAILABLE,
]


# ============================================================
# MONTHS
# ============================================================


def add_months(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def day_share(promotion: dict, month: date) -> float:
    """The share of `month` a promotion runs, 0 to 1."""

    days = monthrange(month.year, month.month)[1]
    start = max(promotion["period_start"], month)
    end = min(promotion["period_end"], month.replace(day=days))
    return max(0, (end - start).days + 1) / days


def weakest_level(levels: list[str | None]) -> str | None:
    known = [level for level in levels if level]
    return max(known, key=LEVEL_ORDER.index) if known else None


# ============================================================
# WHAT A MONTH CARRIES
# ============================================================


def month_uplift(promotions: list[dict], month: date, uplift_for, allowed: set[str] | None = None) -> dict:
    """
    The uplift a month carries, as a fraction (0.04 = +4%): every promotion
    touching it (vouchers left out) at uplift_for(mechanic_key, month) x its
    day share, added up. uplift_for returns choose_uplift's {level,
    uplift_pct}. With `allowed`, a value of any other level counts as 0.

    Also `promotions` (each counted one: mechanic, share, uplift_pct,
    level), the weakest `level`, and `missing`: the mechanics with no value,
    which count as 0 and are named rather than guessed.
    """

    total, counted, missing = 0.0, [], []
    for promotion in promotions:
        share = day_share(promotion, month)
        if share == 0:
            continue
        key = uplift_rules.mechanic_key(promotion.get("promotion_mechanic"))
        if key == uplift_rules.VOUCHER_KEY:
            continue
        chosen = uplift_for(key, month) if key else None
        if chosen is None or chosen["uplift_pct"] is None:
            missing.append(promotion.get("promotion_mechanic") or "(no mechanic)")
            continue
        if allowed is None or chosen["level"] in allowed:
            total += chosen["uplift_pct"] / 100 * share
        counted.append({
            "mechanic": promotion["promotion_mechanic"],
            "share": round(share, 4),
            "uplift_pct": chosen["uplift_pct"],
            "level": chosen["level"],
        })

    return {
        "uplift": total,
        "promotions": counted,
        "level": weakest_level([item["level"] for item in counted]),
        "missing": missing,
    }


# ============================================================
# TIER 0 AND ITS SPLIT
# ============================================================


def tier0_parts(series: dict[date, float], latest: date, target: date) -> dict | None:
    """
    How Tier 0 is built for one series and target month, as the view does:
    the same month last year (when it has sales) and the run-rate months
    (those up to RUN_RATE_MONTHS before `latest`). None when the series has
    no run-rate months.
    """

    recent = sorted(
        month for month in series
        if add_months(latest, -RUN_RATE_MONTHS) < month <= latest
    )
    if not recent:
        return None

    ly_month = add_months(target, -12)
    ly_units = series.get(ly_month) if ly_month <= latest else None
    run_rate = mean(series[month] for month in recent)
    tier0 = run_rate if ly_units is None else LY_WEIGHT * ly_units + (1 - LY_WEIGHT) * run_rate
    return {
        "ly_month": ly_month,
        "ly_units": ly_units,
        "recent": [(month, series[month]) for month in recent],
        "run_rate": run_rate,
        "tier0": tier0,
    }


def split(ly_units: float | None, ly_uplift: float, recent: list[tuple[float, float]], target_uplift: float | None = None) -> dict:
    """
    Tier 0 split into the baseline at the anchor and what promotions carry.
    `recent` is the run-rate months as (units, uplift); uplifts are
    fractions. With target_uplift, also `adjusted`: the baseline with that
    uplift in place of what is carried (None = keep Tier 0).
    """

    run_rate = mean(units for units, _ in recent)
    rr_base = mean(units / (1 + uplift) for units, uplift in recent)
    if ly_units is None:
        tier0, baseline = run_rate, rr_base
    else:
        tier0 = LY_WEIGHT * ly_units + (1 - LY_WEIGHT) * run_rate
        baseline = LY_WEIGHT * ly_units / (1 + ly_uplift) + (1 - LY_WEIGHT) * rr_base

    adjusted = tier0 if target_uplift is None else baseline * (1 + target_uplift)
    return {"tier0": tier0, "baseline": baseline, "carried": tier0 - baseline, "adjusted": adjusted}


def _source(month: date, units: float, carried: dict) -> dict:
    result = {
        "month": month.isoformat(),
        "units": units,
        "uplift_pct": round(carried["uplift"] * 100, 2),
        "promotions": carried["promotions"],
        "level": carried["level"],
        "missing": carried["missing"],
    }
    if carried.get("anchor"):
        anchor = carried["anchor"]
        result["anchor"] = {**anchor, "anchor_pct": float(anchor["anchor_pct"]),
                            "effective_from": anchor["effective_from"].isoformat() if anchor["effective_from"] else None}
    return result


def month_split(series: dict[date, float], latest: date, target: date, carried_for) -> dict | None:
    """
    One series' target month for the Scenario builder: Tier 0, its baseline
    and carried block, the source months with the promotions each carried,
    and the official promotions planned for the target month itself.
    carried_for(month) is month_uplift for this customer x SKU. None when
    Tier 0 cannot be built.
    """

    parts = tier0_parts(series, latest, target)
    if parts is None:
        return None

    ly = carried_for(parts["ly_month"]) if parts["ly_units"] is not None else None
    recent = [(month, units, carried_for(month)) for month, units in parts["recent"]]
    result = split(parts["ly_units"], ly["uplift"] if ly else 0.0, [(units, info["uplift"]) for _, units, info in recent])
    official = carried_for(target)

    sources = ([ly] if ly else []) + [info for _, _, info in recent]
    return {
        "month_year": target.isoformat(),
        "latest_month": latest.isoformat(),
        "tier0": round(result["tier0"], 4),
        "run_rate": round(parts["run_rate"], 4),
        "baseline": round(result["baseline"], 4),
        "carried": round(result["carried"], 4),
        "base_method": "ly+runrate" if ly else "runrate",
        "last_year": _source(parts["ly_month"], parts["ly_units"], ly) if ly else None,
        "recent": [_source(month, units, info) for month, units, info in recent],
        "carried_level": weakest_level([info["level"] for info in sources]),
        "official": {
            "uplift_pct": round(official["uplift"] * 100, 2),
            "promotions": official["promotions"],
            "level": official["level"],
            "missing": official["missing"],
            "planned": bool(official["promotions"] or official["missing"]),
        },
    }
