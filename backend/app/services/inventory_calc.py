from calendar import monthrange
from datetime import date
from math import ceil


# ============================================================
# Constants
# ============================================================

DEFAULT_TARGET_DOH = 30
# There is nowhere to store a per-customer min/max, so both are always
# the target moved by this many days.
DOH_BAND_DAYS = 5
# DOH looks forward this many months from the month being measured.
DOH_WINDOW_MONTHS = 3

# How many future months the sell-in plan covers by default.
SELL_IN_PLAN_MONTHS = 6

DOH_STATUS_BELOW_MIN = "below_min"
DOH_STATUS_WITHIN = "within"
DOH_STATUS_ABOVE_MAX = "above_max"


# ============================================================
# Month helpers
# ============================================================


def month_start(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, months: int) -> date:
    index = value.year * 12 + (value.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)


def days_in_month(value: date) -> int:
    return monthrange(value.year, value.month)[1]


# ============================================================
# Ending stock
#
# Ending stock is never stored. It is rebuilt from the first month
# forward every time, so editing one month's sell-in or sell-out
# flows through to every later month without rewriting any rows.
# ============================================================


def build_monthly_series(
    metrics_by_month: dict[date, dict[str, float]],
    through: date | None = None,
) -> list[dict]:
    """
    Turn one SKU's per-month metric values into a month-by-month stock
    series: ending stock = previous month's ending stock + sell-in -
    sell-out, where sell-out is base plus building blocks.

    The first month is seeded from its own opening_inventory (0 if it has
    none). An opening_inventory on any later month is ignored: it is a
    derived value the chain already reproduces. A month with no data
    between the first and last month is filled with zero movement and
    flagged has_data=False. `through` extends the series past the SKU's
    own last month the same way, so a SKU with no recent rows keeps
    showing the stock it still holds.
    """

    if not metrics_by_month:
        return []

    months = sorted(month_start(m) for m in metrics_by_month)
    last_month = max(months[-1], month_start(through)) if through else months[-1]
    by_month = {month_start(m): values for m, values in metrics_by_month.items()}

    series = []
    month = months[0]
    opening = by_month[month].get("opening_inventory") or 0.0

    while month <= last_month:
        values = by_month.get(month)
        sell_in = (values or {}).get("sell_in") or 0.0
        sell_out_base = (values or {}).get("sell_out_base") or 0.0
        building_blocks = (values or {}).get("sell_out_building_blocks") or 0.0
        sell_out = sell_out_base + building_blocks
        ending = opening + sell_in - sell_out

        series.append(
            {
                "month": month,
                "opening_stock": round(opening, 2),
                "sell_in": round(sell_in, 2),
                "sell_out": round(sell_out, 2),
                # The two parts of sell_out, kept so an edit form can show them.
                "sell_out_base": round(sell_out_base, 2),
                "sell_out_building_blocks": round(building_blocks, 2),
                "ending_stock": round(ending, 2),
                "has_data": values is not None,
            }
        )

        opening = ending
        month = add_months(month, 1)

    return series


# ============================================================
# Days of holding (DOH)
# ============================================================


def forward_daily_sell_out(
    series: list[dict],
    index: int,
    forecast_by_month: dict[date, float],
    window: int = DOH_WINDOW_MONTHS,
) -> float | None:
    """
    Average units sold per day over the `window` months after series[index].
    A month uses its real sell-out when it has data and the forecast
    otherwise; a month with neither is left out of both the units and the
    day count. Returns None when no month in the window has a value, or
    when the total is zero (a DOH cannot be measured against no sales).
    """

    by_month = {row["month"]: row for row in series}
    month = series[index]["month"]

    units = 0.0
    days = 0
    for offset in range(1, window + 1):
        target = add_months(month, offset)
        row = by_month.get(target)
        if row is not None and row["has_data"]:
            units += row["sell_out"]
        elif target in forecast_by_month:
            units += forecast_by_month[target]
        else:
            continue
        days += days_in_month(target)

    if days == 0 or units <= 0:
        return None
    return units / days


def add_doh(series: list[dict], forecast_by_month: dict[date, float]) -> list[dict]:
    """Copy of the series with daily_sell_out and doh added to every month."""

    rows = []
    for index, row in enumerate(series):
        daily = forward_daily_sell_out(series, index, forecast_by_month)
        rows.append(
            {
                **row,
                "daily_sell_out": None if daily is None else round(daily, 4),
                "doh": None if daily is None else round(row["ending_stock"] / daily, 1),
            }
        )
    return rows


def combined_doh(rows: list[dict]) -> float | None:
    """
    One DOH across several SKUs: total ending stock over total daily
    sell-out, counting only SKUs that have a daily rate so a SKU with no
    forward data does not drag the stock total up on its own.
    """

    measurable = [r for r in rows if r.get("daily_sell_out")]
    if not measurable:
        return None
    stock = sum(r["ending_stock"] for r in measurable)
    daily = sum(r["daily_sell_out"] for r in measurable)
    return round(stock / daily, 1)


# ============================================================
# Thresholds
# ============================================================


def threshold_band(target: float) -> tuple[float, float]:
    return target - DOH_BAND_DAYS, target + DOH_BAND_DAYS


def threshold_status(doh: float | None, target: float) -> str | None:
    if doh is None:
        return None
    minimum, maximum = threshold_band(target)
    if doh < minimum:
        return DOH_STATUS_BELOW_MIN
    if doh > maximum:
        return DOH_STATUS_ABOVE_MAX
    return DOH_STATUS_WITHIN


# ============================================================
# Sell-in plan
#
# Works out how much sell-in each month needs so the customer holds the
# target DOH from the start of that month, counting the month itself:
#
#   daily rate      = forecast units of months m, m+1, m+2 / days in those months
#   stock needed    = target DOH x daily rate
#   sell-in (m)     = max(0, round up(stock needed - opening(m) - shipped so far))
#   ending stock(m) = max(0, opening(m) + shipped + sell-in - forecast(m))
#   opening(m+1)    = ending stock(m)
#
# "Shipped so far" is sell-in already sent in a month that has not ended
# yet, so the recommendation is what is left to send. Stock cannot go
# below zero: forecast sales the stock cannot cover are reported as a
# shortfall and are not carried into the next month.
# ============================================================


def forecast_daily_from(
    forecast_by_month: dict[date, float],
    month: date,
    window: int = DOH_WINDOW_MONTHS,
) -> float | None:
    """
    Forecast units per day over `month` and the `window - 1` months after it
    (months with no forecast are left out of both the units and the day
    count). None when none of them is forecast.
    """

    units = 0.0
    days = 0
    for offset in range(window):
        target = add_months(month, offset)
        if target in forecast_by_month:
            units += forecast_by_month[target]
            days += days_in_month(target)

    return units / days if days else None


def build_sell_in_plan(
    opening_stock: float,
    first_month: date,
    months: int,
    forecast_by_month: dict[date, float],
    target_doh_for_month,
    shipped_by_month: dict[date, float] | None = None,
) -> list[dict]:
    """
    Month-by-month plan for one SKU starting at `first_month` with
    `opening_stock` (its last actual ending stock). `target_doh_for_month`
    is called with each month and returns that month's target DOH.
    `shipped_by_month` holds sell-in already sent for months that have not
    ended; it counts towards the month's stock and is taken off what is
    still recommended. The plan stops at the first month with no forecast,
    since nothing can be projected past it.
    """

    shipped_by_month = shipped_by_month or {}
    rows = []
    opening = opening_stock

    for offset in range(months):
        month = add_months(first_month, offset)
        if month not in forecast_by_month:
            break

        forecast = forecast_by_month[month]
        daily = forecast_daily_from(forecast_by_month, month)
        target = target_doh_for_month(month)
        stock_needed = target * daily

        shipped = shipped_by_month.get(month, 0.0)
        recommended = max(0, ceil(stock_needed - opening - shipped - 1e-9))
        stock_after = opening + shipped + recommended
        ending = max(0.0, stock_after - forecast)

        rows.append(
            {
                "month": month,
                "forecast_sell_out": round(forecast, 2),
                "opening_stock": round(opening, 2),
                "shipped_so_far": round(shipped, 2),
                "stock_needed": round(stock_needed, 2),
                "recommended_sell_in": recommended,
                "stock_after_sell_in": round(stock_after, 2),
                "projected_ending_stock": round(ending, 2),
                "shortfall": round(max(0.0, forecast - stock_after), 2),
                # Days of cover the customer has at the start of the month, before
                # this month's recommended sell-in (anything already shipped counts).
                "doh_before_sell_in": None if not daily else round((opening + shipped) / daily, 1),
                "target_doh": target,
            }
        )
        opening = ending

    return rows
