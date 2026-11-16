import re
from decimal import ROUND_HALF_UP, Decimal


# Pure rules behind Promotion Uplift Settings (Promotions Uplift design,
# Sections 6.2 and 6.5): reading free-text mechanics and vouchers, the
# placeholder formula. The anchor recommendation is a moment rule
# (promo_moment_rules.recommend_anchors). No database here.


# ============================================================
# Constants
# ============================================================

VOUCHER_KEY = "voucher"

# Placeholder rule: every ANCHOR_STEP_PCT points of effective discount away
# from the customer's anchor move the uplift by UPLIFT_PER_STEP_PCT points.
ANCHOR_STEP_PCT = Decimal("5")
UPLIFT_PER_STEP_PCT = Decimal("2")

# Used when nothing else gives an anchor (nothing saved for the customer,
# its range or all customers).
FALLBACK_ANCHOR_PCT = Decimal("20")

# Free text typed into promotions.voucher that means "no voucher".
_NO_VOUCHER_VALUES = {"", "no", "none", "n/a", "na", "-", "0"}


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


_DISCOUNT_KEYS = [
    (re.compile(rf"^pct_off_{_PCT}$"), lambda m: Decimal(m[1])),
    # Buy N Get M Free: M of every N + M units are free.
    (re.compile(r"^b(\d+)g(\d+)$"), lambda m: Decimal(m[2]) * 100 / (Decimal(m[1]) + Decimal(m[2]))),
    # Buy N Get P% Off: the P% comes off one of the N units (migration 032).
    (re.compile(rf"^b(\d+)_pct_off_{_PCT}$"), lambda m: Decimal(m[2]) / Decimal(m[1])),
]


def derived_discount(mechanic_key: str | None) -> Decimal | None:
    """
    The per-piece discount a mechanic key states, to 0.1 ("b2g1" -> 33.3,
    "b2_pct_off_25" -> 12.5), as the seeded settings measure it; None when the
    key states none (a voucher) or the numbers make no discount.
    """

    for pattern, build in _DISCOUNT_KEYS:
        match = pattern.match(mechanic_key or "")
        if not match:
            continue
        try:
            discount = build(match)
        except ArithmeticError:
            return None
        if not 0 < discount <= 100:
            return None
        return discount.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP).normalize()
    return None


def discount_or_derived(saved: Decimal | None, mechanic_key: str | None) -> Decimal | None:
    """
    A mechanic's discount wherever one is looked up: the saved one, else the
    one its key states (derived_discount), so the Current and Initial
    breakdowns and Promotion Uplift Settings never disagree on a mechanic
    nobody configured.
    """

    return saved if saved is not None else derived_discount(mechanic_key)


def placeholder_uplift(effective_discount_pct: Decimal, anchor_pct: Decimal) -> Decimal:
    """(discount - anchor) / 5 x 2, to a whole percent: 30% Off at a 20% anchor is +4."""

    steps = (Decimal(effective_discount_pct) - Decimal(anchor_pct)) / ANCHOR_STEP_PCT
    return (steps * UPLIFT_PER_STEP_PCT).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
