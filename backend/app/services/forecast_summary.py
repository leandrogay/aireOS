"""
The sell-out forecast in plain numbers, for the assistant's get_demand_forecast tool.

It reads exactly what the Forecast page reads (bigquery.get_forecast_output_rows
for the Current line, bigquery.get_forecast_actuals for the Actual line, and the
same freshness stamps) and applies the page's own display rules, so a figure the
assistant quotes is the figure the page shows for the same SKU, customer and month:

  - cartons are rounded to whole numbers the way the page's Math.round() does,
    after summing (a total is the rounded sum, never a sum of rounded values),
  - confidence is taken from the earliest month with a Current forecast, with the
    same labels and reasons as forecastConfidence() in app/utils/forecastView.js,
  - revenue is priced by the page's own forecast_service.add_forecast_revenue at
    the same realised prices (bigquery.get_realised_prices).

Keep the two in sync: a change to the page's rounding or confidence wording must
be made here too.
"""

import datetime
import math
import re
from concurrent.futures import ThreadPoolExecutor

from app.services import forecast_service
from app.services import bigquery as bigquery_service

MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")

# A question with no period ("what's the forecast?") gets the first few
# forecast months, the near-term outlook people plan against.
DEFAULT_FORECAST_MONTHS = 3
# Actual months shown before the forecast window, for comparison. One series
# (one customer x SKU) gets a short trend; many get only the latest month, so
# the table stays readable.
RECENT_ACTUAL_MONTHS_ONE_SERIES = 3
RECENT_ACTUAL_MONTHS_MANY_SERIES = 1
# How far back to read actuals to find those months, allowing for a gap of
# months with no sales loaded yet between the last actual and the forecast.
ACTUALS_LOOKBACK_MONTHS = 6

CHANNEL = "Online and offline combined"
UNIT = "cartons"
# The months a realised price is averaged over (bigquery.get_realised_prices).
REALISED_PRICE_MONTHS = bigquery_service.REALISED_PRICE_MONTHS
REVENUE_BASIS = (
    "Forecast revenue is forecast cartons x each SKU's realised price per carton "
    f"(revenue / cartons over its latest {REALISED_PRICE_MONTHS} "
    "complete sales months), as on the Forecast page's Revenue view."
)

# Bands come from current_confidence_band (sMAPE < 20 high, 20-50 medium,
# > 50 low). Same labels as CONFIDENCE_LABELS in app/utils/forecastView.js.
CONFIDENCE_LABELS = {
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "unknown": "Not yet scored",
}

_SINGAPORE_TZ = datetime.timezone(datetime.timedelta(hours=8))


# ============================================================
# DISPLAY RULES (mirror the Forecast page)
# ============================================================


def whole_cartons(value: float | None) -> int | None:
    """Rounded like JavaScript's Math.round (halves go up), not Python's
    round() (halves go to even), so 52.5 shows as 53 here and on the page."""
    if value is None:
        return None
    return math.floor(value + 0.5)


def _confidence_reason(band: str, short_history: bool) -> str:
    if band == "high":
        return "model tracked actual sales closely when tested on past months"
    if band == "medium":
        return "sales vary month to month, review recommended"
    if band == "low":
        if short_history:
            return "limited sales history, check before using"
        return "sales swing a lot month to month, check before using"
    return "too new to test against past sales"


def _confidence_detail(band: str, smape: float | None) -> str:
    if smape is None:
        accuracy = "This forecast has not been tested against past sales yet."
    else:
        accuracy = (
            f"In recent test months this forecast was typically off by about "
            f"{whole_cartons(smape)}% from actual sales."
        )
    action = {
        "high": "Safe to use for planning.",
        "medium": "Worth a quick review before committing stock or promos.",
        "low": "Review manually before using it for orders or promo plans.",
        "unknown": "Treat it as a rough guide until it has been scored.",
    }[band]
    return f"{accuracy} {action}"


def forecast_confidence(rows: list[dict]) -> dict | None:
    """Confidence for one customer x SKU, from its earliest month with a
    Current forecast (the band is the same on every month of a run). None when
    there is no Current forecast to rate."""
    rated = sorted(
        (row for row in rows if row.get("forecast_current") is not None and row.get("month_year")),
        key=lambda row: row["month_year"],
    )
    if not rated:
        return None
    first = rated[0]
    band = first.get("current_confidence_band")
    if band not in CONFIDENCE_LABELS:
        band = "unknown"
    # The pipeline falls back to Tier 0 below 6 months of history.
    short_history = first.get("current_source_model") == "tier0_legacy"
    return {
        "band": band,
        "label": CONFIDENCE_LABELS[band],
        "reason": _confidence_reason(band, short_history),
        "detail": _confidence_detail(band, first.get("current_backtest_smape")),
    }


def format_sgt_timestamp(value: str | None) -> str | None:
    """A pipeline UTC stamp in Singapore time, written like the page's
    formatSgtTimestamp: '4 Oct 2026, 1:14 am'."""
    if not value:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    local = stamp.astimezone(_SINGAPORE_TZ)
    hour = local.hour % 12 or 12
    meridiem = "am" if local.hour < 12 else "pm"
    return f"{local.day} {local:%b %Y}, {hour}:{local.minute:02d} {meridiem}"


def month_label(month_year: str) -> str:
    """'2026-09-01' -> 'Sep 2026'."""
    return datetime.date.fromisoformat(month_year[:10]).strftime("%b %Y")


# ============================================================
# SCOPE (which customer, SKU and months)
# ============================================================


def _first_of_month(value: str, field_name: str) -> datetime.date:
    if not MONTH_PATTERN.match(value or ""):
        raise ValueError(f"{field_name} must be YYYY-MM, got '{value}'.")
    return datetime.date(int(value[:4]), int(value[5:7]), 1)


def _add_months(month: datetime.date, count: int) -> datetime.date:
    index = month.year * 12 + month.month - 1 + count
    return datetime.date(index // 12, index % 12 + 1, 1)


def _resolve_name(wanted: str | None, known: list[str], kind: str, aliases: dict[str, str] | None = None) -> str | None:
    """The one known name `wanted` refers to: an exact match (ignoring case),
    a SKU code via `aliases`, else the only name containing it. Raises
    ValueError naming the options when there is no match or more than one."""
    if not wanted:
        return None
    needle = wanted.strip().lower()
    for name in known:
        if name.lower() == needle:
            return name
    if aliases and needle in aliases:
        return aliases[needle]
    matches = [name for name in known if needle in name.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No forecast for {kind} '{wanted}'. {kind.capitalize()}s with a forecast: {', '.join(known)}.")
    raise ValueError(f"'{wanted}' matches more than one {kind} ({', '.join(matches)}); be more specific.")


def resolve_scope(rows: list[dict], product: str | None, customer: str | None) -> tuple[str | None, str | None]:
    """(product_name, customer_name) exactly as the Forecast page's filters
    hold them, from what the user typed. None means every one."""
    products = sorted({row["product_name"] for row in rows if row.get("product_name")})
    customers = sorted({row["customer_name"] for row in rows if row.get("customer_name")})
    sku_codes = {str(row["sku"]).lower(): row["product_name"] for row in rows if row.get("sku") and row.get("product_name")}
    # Customers are stored as slugs (sheng_shiong); people type "Sheng Shiong".
    customer_wanted = customer.strip().lower().replace(" ", "_") if customer else None
    return (
        _resolve_name(product, products, "product", sku_codes),
        _resolve_name(customer_wanted, customers, "customer"),
    )


def forecast_window(rows: list[dict], start_month: str | None, end_month: str | None) -> tuple[datetime.date, datetime.date] | None:
    """The months asked about, first-of-month dates, inclusive. With no start,
    the first DEFAULT_FORECAST_MONTHS months that have a Current forecast; a
    start with no end is that one month. None when there is no forecast at all
    to default to."""
    if start_month:
        start = _first_of_month(start_month, "start_month")
        end = _first_of_month(end_month, "end_month") if end_month else start
    else:
        forecast_months = sorted(row["month_year"] for row in rows if row.get("forecast_current") is not None)
        if not forecast_months:
            return None
        start = datetime.date.fromisoformat(forecast_months[0])
        end = _first_of_month(end_month, "end_month") if end_month else _add_months(start, DEFAULT_FORECAST_MONTHS - 1)
    if end < start:
        raise ValueError("end_month is before start_month.")
    return start, end


# ============================================================
# SUMMARY
# ============================================================


def _money(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _sum_money(values: list) -> float | None:
    """Dollars to the cent, adding up only the values that exist (the page
    skips a blank month or SKU rather than counting it as $0). None if none do."""
    present = [value for value in values if value is not None]
    return round(sum(present), 2) if present else None


def _in_window(month_year: str | None, start: datetime.date, end: datetime.date) -> bool:
    return bool(month_year) and start <= datetime.date.fromisoformat(month_year[:10]) <= end


def summarise(
    rows: list[dict],
    actuals: list[dict],
    product_name: str | None,
    customer_name: str | None,
    window: tuple[datetime.date, datetime.date],
    freshness: dict,
    today: datetime.date,
    prices: dict[tuple[int, str], float] | None = None,
) -> dict:
    """
    One customer x SKU series per pair in scope, each with its Forecast months
    (the Current line, with its 80% range and confidence) and its Actual months
    kept apart, plus month totals across series when there is more than one
    (what the page shows for All SKUs / All customers). Pure: the reads happen
    in get_demand_forecast.

    Revenue is the page's Revenue view: each forecast row's cartons priced at
    that customer x SKU's realised price (prices, keyed (customer_id, sku)) by
    the page's own forecast_service.add_forecast_revenue, and actual revenue
    as recorded. A SKU with no price has no forecast revenue (None, never 0),
    and a total adds up only the revenue that exists, as the page does.
    """
    start, end = window
    scoped = [
        row for row in rows
        if (product_name is None or row.get("product_name") == product_name)
        and (customer_name is None or row.get("customer_name") == customer_name)
    ]
    forecast_rows = [row for row in scoped if row.get("forecast_current") is not None]
    all_forecast_months = sorted({row["month_year"] for row in forecast_rows})
    window_rows = forecast_service.add_forecast_revenue(
        [row for row in forecast_rows if _in_window(row.get("month_year"), start, end)],
        prices or {},
    )

    series_keys = sorted({(row["customer_name"], row["product_name"]) for row in window_rows})
    many = len(series_keys) > 1
    actual_months_before = RECENT_ACTUAL_MONTHS_MANY_SERIES if many else RECENT_ACTUAL_MONTHS_ONE_SERIES
    this_month = today.replace(day=1)

    in_scope_actuals = [
        row for row in actuals
        if (row.get("customer_name"), row.get("product_name")) in series_keys and row.get("quantity_cartons") is not None
    ]
    # The latest months that HAVE sales, not simply the calendar months before
    # the window: sales land a few days into the next month, so the month just
    # before a forecast is often still empty.
    months_before = sorted({
        row["month_year"] for row in in_scope_actuals
        if row.get("month_year") and datetime.date.fromisoformat(row["month_year"][:10]) < start
    })[-actual_months_before:]
    shown_actual_months = set(months_before) | {
        row["month_year"] for row in in_scope_actuals if _in_window(row.get("month_year"), start, end)
    }

    def actual_months_for(customer: str, product: str) -> list[dict]:
        cartons_by_month: dict[str, float] = {}
        revenue_by_month: dict[str, list] = {}
        for row in in_scope_actuals:
            if row.get("customer_name") != customer or row.get("product_name") != product:
                continue
            if row["month_year"] not in shown_actual_months:
                continue
            month = row["month_year"]
            cartons_by_month[month] = cartons_by_month.get(month, 0) + row["quantity_cartons"]
            revenue_by_month.setdefault(month, []).append(row.get("revenue"))
        return [
            {
                "month": month,
                "cartons": whole_cartons(value),
                "revenue": _sum_money(revenue_by_month[month]),
                # The current month is still filling up, so it is not a full month's sales.
                "month_to_date": datetime.date.fromisoformat(month[:10]) >= this_month,
                "_raw": value,
            }
            for month, value in sorted(cartons_by_month.items())
        ]

    series = []
    for customer, product in series_keys:
        own_rows = [row for row in window_rows if row["customer_name"] == customer and row["product_name"] == product]
        own_rows.sort(key=lambda row: row["month_year"])
        series.append({
            "customer": customer,
            "product_name": product,
            "sku": own_rows[0].get("sku"),
            "confidence": forecast_confidence(own_rows),
            # Revenue / cartons over the SKU's latest sales months; None when it has no sales to price from.
            "realised_price": _money(own_rows[0].get("realised_price")),
            "forecast": [
                {
                    "month": row["month_year"],
                    "cartons": whole_cartons(row["forecast_current"]),
                    "low_80": whole_cartons(row.get("current_low_80")),
                    "high_80": whole_cartons(row.get("current_high_80")),
                    "revenue": row.get("forecast_current_revenue"),
                    "_raw": row["forecast_current"],
                }
                for row in own_rows
            ],
            "actuals": actual_months_for(customer, product),
        })

    monthly_totals = []
    if many:
        months = sorted({entry["month"] for item in series for entry in item["forecast"] + item["actuals"]})
        for month in months:
            forecasts = [e for item in series for e in item["forecast"] if e["month"] == month]
            actuals_in_month = [e for item in series for e in item["actuals"] if e["month"] == month]
            monthly_totals.append({
                "month": month,
                "forecast_cartons": whole_cartons(sum(e["_raw"] for e in forecasts)) if forecasts else None,
                "forecast_revenue": _sum_money([e["revenue"] for e in forecasts]),
                "actual_cartons": whole_cartons(sum(e["_raw"] for e in actuals_in_month)) if actuals_in_month else None,
                "actual_revenue": _sum_money([e["revenue"] for e in actuals_in_month]),
                "actual_month_to_date": bool(actuals_in_month) and datetime.date.fromisoformat(month[:10]) >= this_month,
            })

    forecast_total = sum(e["_raw"] for item in series for e in item["forecast"])
    forecast_total_revenue = _sum_money([e["revenue"] for item in series for e in item["forecast"]])
    for item in series:
        for entry in item["forecast"] + item["actuals"]:
            entry.pop("_raw")

    return {
        "customer": customer_name,
        "product_name": product_name,
        "channel": CHANNEL,
        "unit": UNIT,
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "forecast_months_available": (
            {"first": all_forecast_months[0], "last": all_forecast_months[-1]} if all_forecast_months else None
        ),
        "forecast_generated_at": freshness.get("current_generated_at"),
        "forecast_generated_at_sgt": format_sgt_timestamp(freshness.get("current_generated_at")),
        "actuals_loaded_at": freshness.get("latest_sales_loaded_at"),
        "actuals_loaded_at_sgt": format_sgt_timestamp(freshness.get("latest_sales_loaded_at")),
        "series": series,
        "monthly_totals": monthly_totals,
        "forecast_total_cartons": whole_cartons(forecast_total) if series else None,
        "forecast_total_revenue": forecast_total_revenue,
        "revenue_basis": REVENUE_BASIS,
    }


# ============================================================
# READ
# ============================================================


def get_demand_forecast(
    product: str | None = None,
    customer: str | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
    today: datetime.date | None = None,
) -> dict:
    """The Forecast page's figures for one question: resolve the names the
    user typed to the page's own filter values, pick the months, then read
    the actuals and freshness for exactly that scope."""
    rows = bigquery_service.get_forecast_output_rows()
    product_name, customer_name = resolve_scope(rows, product, customer)
    scoped = [
        row for row in rows
        if (product_name is None or row.get("product_name") == product_name)
        and (customer_name is None or row.get("customer_name") == customer_name)
    ]
    window = forecast_window(scoped, start_month, end_month)
    if window is None:
        raise ValueError("There is no forecast for that product and customer yet.")
    start, end = window
    actual_start = _add_months(start, -ACTUALS_LOOKBACK_MONTHS)
    # Last day of the end month, so the whole month counts.
    actual_end = _add_months(end, 1) - datetime.timedelta(days=1)

    with ThreadPoolExecutor(max_workers=3) as pool:
        actuals_job = pool.submit(
            bigquery_service.get_forecast_actuals,
            product_name=product_name,
            customer_name=customer_name,
            start_date=actual_start.isoformat(),
            end_date=actual_end.isoformat(),
        )
        loaded_job = pool.submit(bigquery_service.get_sales_loaded_at, customer_name=customer_name)
        prices_job = pool.submit(
            bigquery_service.get_realised_prices,
            product_name=product_name,
            customer_name=customer_name,
        )
        actuals = actuals_job.result()
        sales_loaded_at = loaded_job.result()
        prices = prices_job.result()

    # Same stamp the page shows as "last run": the latest Current run in scope.
    stamps = [row["current_generated_at"] for row in scoped if row.get("current_generated_at")]
    freshness = {
        "current_generated_at": max(stamps) if stamps else None,
        "latest_sales_loaded_at": sales_loaded_at,
    }
    return summarise(
        rows, actuals, product_name, customer_name, window, freshness,
        today or datetime.datetime.now(_SINGAPORE_TZ).date(),
        prices,
    )
