"""Customer chart colours: the allowed set, how a new customer's is picked,
and when a chosen one is refused. Pure, no I/O.

Every customer has one colour, stored on its row (customers.color, migration
018) and used by every chart (frontend utils/customerColors.js). Stored, not
derived, so adding, renaming or deleting a customer never moves anyone else's
colour. No two customers may have colours that look alike.
A colour picked automatically for a new customer also reads on the white
chart panel (3:1 contrast, the WCAG floor for graphics) and keeps clear of the
Forecast / Scenario / Sell-in Outlook line colours, so a customer is never
mistaken for Current, Previous or Initial. A colour chosen on the Customers
page is not held to those: whoever picks it can see the charts and change it
if it is too light, too dark or clashes.
"Look like" is CIE76 colour difference (Delta E): about 2 is just noticeable,
25 is clearly a different colour at a glance.
"""

import colorsys
import math
from functools import lru_cache

# ============================================================
# Constants
# ============================================================

# The fixed line colours on the charts customers share space with (frontend
# forecastView FORECAST_SERIES, scenarioEngine's Simulated, scenarioModelView,
# SellInOutlookChart SERIES). Promo bands are translucent fills, not lines, so
# they are not here. Change both sides together.
LINE_COLORS = (
    "#3A4369",  # Actual for All customers (AIRE deep blue)
    "#E8922A",  # Initial
    "#7C3AED",  # Previous
    "#0D9488",  # Current
    "#D23F74",  # Scenario Simulated
    "#9AA0B4",  # Scenario model view reference
    "#0B4FD9",  # Outlook sell-in Current
    "#00AEC2",  # Outlook sell-out Current
    "#1E9E3A",  # Outlook sell-in Previous
    "#7F4A08",  # Outlook sell-in Initial
    "#E02FA6",  # Outlook sell-out Previous
    "#F58A00",  # Outlook sell-out Initial
)

MIN_CONTRAST = 3.0
MIN_LINE_DISTANCE = 25.0
MIN_CUSTOMER_DISTANCE = 20.0

# The colours a new customer is given, the most distinct free one first (the
# Customers page can then change it on a colour wheel). The first ten are the ones customers had before colours were stored
# (migration 018); the rest were picked as far from those and from the line
# colours as possible. tests/test_customer_colors.py checks every rule above.
COLOR_CHOICES = (
    "#7A70B8",  # violet (FairPrice)
    "#9A7B00",  # gold (Sheng Siong)
    "#2E7BA6",  # blue (NHG)
    "#C45C26",  # rust (SingHealth)
    "#6B8E23",  # olive (Prime)
    "#2D4A22",  # dark green
    "#8E5572",  # mauve
    "#7B2D26",  # maroon
    "#5F0F40",  # plum
    "#3B2F80",  # indigo
    "#CD1DCD",  # magenta
    "#CD1D35",  # crimson
    "#8B2384",  # purple
    "#4A1698",  # royal purple
    "#307E44",  # green
    "#686827",  # khaki
)


# ============================================================
# Colour maths
# ============================================================


def _linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _rgb(color: str) -> tuple[float, float, float]:
    return tuple(int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))


def _lab(color: str) -> tuple[float, float, float]:
    r, g, b = (_linear(c) for c in _rgb(color))

    def f(t: float) -> float:
        return math.cbrt(t) if t > 0.008856 else 7.787 * t + 16 / 116

    x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
    y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
    z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return 116 * y - 16, 500 * (x - y), 200 * (y - z)


def color_distance(a: str, b: str) -> float:
    """CIE76 Delta E between two #RRGGBB colours."""
    return math.dist(_lab(a), _lab(b))


def contrast_on_white(color: str) -> float:
    """WCAG contrast ratio of a #RRGGBB colour against white."""
    r, g, b = (_linear(c) for c in _rgb(color))
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return 1.05 / (luminance + 0.05)


def _allowed_on_charts(color: str) -> bool:
    return contrast_on_white(color) >= MIN_CONTRAST and all(
        color_distance(color, line) >= MIN_LINE_DISTANCE for line in LINE_COLORS
    )


@lru_cache(maxsize=1)
def _fallback_pool() -> tuple[str, ...]:
    # Only once every choice is taken: a fine grid of hues, lightnesses and
    # saturations, kept to the colours allowed on the charts.
    pool = []
    for hue in range(0, 360, 4):
        for lightness in (0.28, 0.34, 0.40, 0.46):
            for saturation in (0.45, 0.60, 0.75):
                r, g, b = colorsys.hls_to_rgb(hue / 360, lightness, saturation)
                color = "#{:02X}{:02X}{:02X}".format(round(r * 255), round(g * 255), round(b * 255))
                if _allowed_on_charts(color):
                    pool.append(color)
    return tuple(pool)


# ============================================================
# Public
# ============================================================


def pick_color(taken: list[str]) -> str:
    """The colour for a new customer: of the free choices, the one farthest
    from every colour already taken and every line colour, so a new customer
    is as easy to tell apart as possible. Ties go to the earlier choice, so the
    same customers always give the same pick."""
    used = {color.upper() for color in taken}
    free = [color for color in COLOR_CHOICES if color not in used]
    if not free:
        free = [color for color in _fallback_pool() if color not in used]
    neighbours = [*used, *LINE_COLORS]
    return max(free, key=lambda color: min(color_distance(color, other) for other in neighbours))


def color_problem(color: str, other_customers: dict[str, str]) -> str | None:
    """Why `color` (#RRGGBB) can't be a customer's colour, as a sentence for
    the Customers page, or None when it can. `other_customers` maps every other
    customer's name to its colour."""
    for name, other in other_customers.items():
        if other and color_distance(color, other) < MIN_CUSTOMER_DISTANCE:
            return f"This colour looks too much like {name}'s. Pick another one."
    return None
