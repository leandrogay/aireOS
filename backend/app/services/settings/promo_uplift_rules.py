import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from statistics import median


# Pure rules behind Promotion Uplift Settings (Promotions Uplift design,
# Sections 6.2 and 6.5): reading free-text mechanics and vouchers, the
# placeholder formula, and the per-customer anchor suggestion. No database
# here; promo_uplifts.py feeds these the rows it reads.


# ============================================================
# Constants
# ============================================================

VOUCHER_KEY = "voucher"

# Placeholder rule: every ANCHOR_STEP_PCT points of effective discount away
# from the customer's anchor move the uplift by UPLIFT_PER_STEP_PCT points.
ANCHOR_STEP_PCT = Decimal("5")
UPLIFT_PER_STEP_PCT = Decimal("2")

# Used when nothing else gives an anchor (no manual value, no data, no
# all-customers row).
FALLBACK_ANCHOR_PCT = Decimal("20")

# The suggestion looks at the customer's most recent months of promotions.
ANCHOR_WINDOW_MONTHS = 24

# Free text typed into promotions.voucher that means "no voucher".
_NO_VOUCHER_VALUES = {"", "no", "none", "n/a", "na", "-", "0"}

_MONTHLY_TYPE = "monthly"


# ============================================================
# MECHANICS AND VOUCHERS
#
# promotions.promotion_mechanic is typed by hand ("25%", "25% Off",
# "Buy 2 Get 25%"), so labels are matched by their pattern, not their exact
# text. Every uplift lookup goes through the key this returns.
# ============================================================

_PCT = r"(\d+(?:\.\d+)?)"

_PATTERNS = [
    (re.compile(r"^voucher$"), lambda m: VOUCHER_KEY),
    (re.compile(r"^b(\d+)g(\d+)$"), lambda m: f"b{m[1]}g{m[2]}"),
    (re.compile(r"^buy (\d+) get (\d+) free$"), lambda m: f"b{m[1]}g{m[2]}"),
    (re.compile(rf"^buy (\d+) get {_PCT}% ?(?:off)?$"), lambda m: f"b{m[1]}_pct_off_{_number(m[2])}"),
    (re.compile(rf"^{_PCT}% ?(?:off)?$"), lambda m: f"pct_off_{_number(m[1])}"),
]


def _number(text: str) -> str:
    # "25" and "25.0" are the same mechanic.
    value = Decimal(text)
    return str(int(value)) if value == value.to_integral_value() else str(value.normalize())


def _normalise(label: str) -> str:
    text = " ".join(label.lower().split())
    return re.sub(r"\s*%\s*", "% ", text).strip()


def mechanic_key(label: str | None) -> str | None:
    """The mechanic a free-text label means, e.g. "25 % OFF" -> 'pct_off_25'; None when unreadable."""

    if not label:
        return None

    text = _normalise(label)
    for pattern, build in _PATTERNS:
        match = pattern.match(text)
        if match:
            return build(match)
    return None


def voucher_flag(voucher: str | None, mechanic: str | None = None) -> int:
    """
    1 when a promotion carries a voucher, else 0. promotions.voucher holds
    an amount ("$3 off $30") or nothing, and a promotion whose mechanic is
    "Voucher" is a voucher too.
    """

    if mechanic_key(mechanic) == VOUCHER_KEY:
        return 1
    value = (voucher or "").strip().lower()
    return 0 if value in _NO_VOUCHER_VALUES else 1


# ============================================================
# PLACEHOLDER UPLIFT
# ============================================================


def placeholder_uplift(effective_discount_pct: Decimal, anchor_pct: Decimal) -> Decimal:
    """(discount - anchor) / 5 x 2, to a whole percent: 30% Off at a 20% anchor is +4."""

    steps = (Decimal(effective_discount_pct) - Decimal(anchor_pct)) / ANCHOR_STEP_PCT
    return (steps * UPLIFT_PER_STEP_PCT).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# ============================================================
# ANCHOR SUGGESTION
#
# A customer's ordinary-month discount, from its own promotions. Within a
# month, a monthly promotion sets the discount and any other promotion
# (side offer, bundle, others) replaces it for the days it runs; the deepest
# wins when promotions of the same kind overlap. Days covered only by a
# promotion with no percentage discount (a "Voucher" mechanic, or a label
# that cannot be read) are left out, as are days with no promotion.
# ============================================================


def _base_type(promo_type: str | None) -> str:
    # carton_monthly is a monthly promotion for a different pack.
    return (promo_type or "").removeprefix("carton_")


def _days(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def monthly_discounts(promotions: list[dict], discount_by_key: dict[str, Decimal]) -> dict[date, Decimal]:
    """
    One effective discount per month ({first of month: pct}), weighted by
    days. Each promotion needs period_start, period_end (dates), promo_type
    and promotion_mechanic; discount_by_key maps a mechanic key to its
    effective discount.
    """

    background: dict[date, Decimal] = {}
    overlay: dict[date, Decimal] = {}

    for promotion in promotions:
        discount = discount_by_key.get(mechanic_key(promotion.get("promotion_mechanic")))
        if discount is None:
            continue

        target = background if _base_type(promotion.get("promo_type")) == _MONTHLY_TYPE else overlay
        for day in _days(promotion["period_start"], promotion["period_end"]):
            target[day] = max(target.get(day, discount), discount)

    by_month: dict[date, list[Decimal]] = {}
    for day in set(background) | set(overlay):
        value = overlay.get(day, background.get(day))
        by_month.setdefault(day.replace(day=1), []).append(value)

    return {month: sum(values) / len(values) for month, values in sorted(by_month.items())}


def _months_back(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 - count
    return date(index // 12, index % 12 + 1, 1)


def suggest_anchor(monthly: dict[date, Decimal]) -> dict | None:
    """
    The median monthly discount over the ANCHOR_WINDOW_MONTHS months up to
    the latest month with a value, to a whole percent, with the months it
    used. None when there is no month to go on.
    """

    if not monthly:
        return None

    latest = max(monthly)
    first_allowed = _months_back(latest, ANCHOR_WINDOW_MONTHS - 1)
    months = sorted(month for month in monthly if month >= first_allowed)
    value = Decimal(median(monthly[month] for month in months))

    return {
        "anchor_pct": value.quantize(Decimal("1"), rounding=ROUND_HALF_UP),
        "months_used": len(months),
        "first_month": months[0].isoformat(),
        "last_month": months[-1].isoformat(),
    }
