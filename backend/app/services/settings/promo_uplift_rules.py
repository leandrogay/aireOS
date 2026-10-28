import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from statistics import median


# Pure rules behind Promotion Uplift Settings (Promotions Uplift design,
# Sections 6.2 and 6.5): reading free-text mechanics and vouchers, the
# rule behind rule-based uplifts, and the per-customer anchor suggestion. No
# database here; promo_uplifts.py feeds these the rows it reads.


# ============================================================
# Constants
# ============================================================

VOUCHER_KEY = "voucher"

# The rule behind rule-based uplifts: assume sales rise this many percent
# for every percentage point of discount deeper than the customer's normal
# (anchor) discount. 0.4 = 5 points deeper -> +2%. A deliberately small,
# conservative starting assumption, not measured from Aire's data; users can
# change it on the settings page (promo_rule_settings).
DEFAULT_UPLIFT_PER_POINT_PCT = Decimal("0.4")

# Every rule-based uplift is kept within the range the settings table allows
# (the same as measured uplifts), so a large rate can never break a save.
MIN_UPLIFT_PCT = Decimal("-90")
MAX_UPLIFT_PCT = Decimal("300")

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


_PCT_KEY = re.compile(r"^(?:b(\d+)_)?pct_off_(\d+(?:\.\d+)?)$")
_FREE_KEY = re.compile(r"^b(\d+)g(\d+)$")


def effective_discount(key: str | None) -> Decimal | None:
    """
    The discount per unit a mechanic key gives when the shopper takes the full
    deal: pct_off_30 and b2_pct_off_30 -> 30; Buy N Get M Free -> M / (N + M),
    so b1g1 -> 50 and b2g1 -> 33.3. None for the voucher and unknown keys.
    """

    if not key:
        return None
    match = _PCT_KEY.match(key)
    if match:
        return Decimal(match[2])
    match = _FREE_KEY.match(key)
    if match:
        paid, free = int(match[1]), int(match[2])
        if paid + free == 0:
            return None
        return (Decimal(100) * free / (paid + free)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return None


def label_for_key(key: str) -> str:
    """The standard label for a key, e.g. 'b2_pct_off_25' -> 'Buy 2 Get 25% Off'."""

    if key == VOUCHER_KEY:
        return "Voucher"
    match = _PCT_KEY.match(key)
    if match and match[1]:
        return f"Buy {match[1]} Get {match[2]}% Off"
    if match:
        return f"{match[2]}% Off"
    match = _FREE_KEY.match(key)
    if match:
        return f"Buy {match[1]} Get {match[2]} Free"
    return key


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
# RULE-BASED UPLIFT
# ============================================================


def _uncapped_rule_based_uplift(effective_discount_pct, anchor_pct, uplift_per_point_pct) -> Decimal:
    points = Decimal(str(effective_discount_pct)) - Decimal(str(anchor_pct))
    return (points * Decimal(str(uplift_per_point_pct))).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def rule_based_uplift(
    effective_discount_pct: Decimal,
    anchor_pct: Decimal,
    uplift_per_point_pct: Decimal = DEFAULT_UPLIFT_PER_POINT_PCT,
) -> Decimal:
    """
    (discount - anchor) x rate, to a whole percent, halves away from zero, kept
    within -90..+300. At the default 0.4: 30% Off at a 25% anchor is +2.
    """

    value = _uncapped_rule_based_uplift(effective_discount_pct, anchor_pct, uplift_per_point_pct)
    return min(max(value, MIN_UPLIFT_PCT), MAX_UPLIFT_PCT)


def rule_based_uplift_capped(
    effective_discount_pct: Decimal,
    anchor_pct: Decimal,
    uplift_per_point_pct: Decimal = DEFAULT_UPLIFT_PER_POINT_PCT,
) -> bool:
    """True when the rule's answer had to be kept within -90..+300."""

    value = _uncapped_rule_based_uplift(effective_discount_pct, anchor_pct, uplift_per_point_pct)
    return not MIN_UPLIFT_PCT <= value <= MAX_UPLIFT_PCT


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


def active_by_store_day(
    promotions: list[dict],
    discount_by_key: dict[str, Decimal],
    before: date | None = None,
) -> dict[tuple, tuple[str, Decimal]]:
    """
    The discount mechanic running at each store on each day: {(store, day):
    (mechanic_key, discount)}. A monthly promotion sets the store's discount;
    any other type (side offer, bundle, others) replaces it for its days; the
    deepest wins when two of the same kind overlap. Promotions with no
    percentage discount (a "Voucher" mechanic, an unreadable label) are left
    out. Each promotion needs period_start, period_end, promo_type and either
    mechanic_key or promotion_mechanic; `stores` is optional (missing = one
    store, None). Days on or after `before` are left out.
    """

    background: dict[tuple, tuple[str, Decimal]] = {}
    overlay: dict[tuple, tuple[str, Decimal]] = {}

    for promotion in promotions:
        key = promotion.get("mechanic_key") or mechanic_key(promotion.get("promotion_mechanic"))
        discount = discount_by_key.get(key)
        if discount is None:
            continue

        target = background if _base_type(promotion.get("promo_type")) == _MONTHLY_TYPE else overlay
        stores = promotion.get("stores") or (None,)
        for day in _days(promotion["period_start"], promotion["period_end"]):
            if before is not None and day >= before:
                break
            for store in stores:
                current = target.get((store, day))
                if current is None or discount > current[1]:
                    target[(store, day)] = (key, discount)

    return {**background, **overlay}


def monthly_discounts(
    promotions: list[dict],
    discount_by_key: dict[str, Decimal],
    store_weights: dict | None = None,
    before: date | None = None,
) -> dict[date, Decimal]:
    """
    One effective discount per month ({first of month: pct}): the average over
    the store-days that had a discount, each store weighted by its share of
    the customer's sales (store_weights), so a promotion in a few small stores
    counts for little. Without store_weights every store counts the same.
    Months on or after `before` are left out, so planned promotions never
    shape the suggestion.
    """

    totals: dict[date, list[Decimal]] = {}
    for (store, day), (_key, discount) in active_by_store_day(promotions, discount_by_key, before).items():
        weight = Decimal(1) if not store_weights else Decimal(str(store_weights.get(store, 0)))
        if weight <= 0:
            continue
        month_total = totals.setdefault(day.replace(day=1), [Decimal(0), Decimal(0)])
        month_total[0] += weight * discount
        month_total[1] += weight

    return {month: total / weight for month, (total, weight) in sorted(totals.items())}


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
