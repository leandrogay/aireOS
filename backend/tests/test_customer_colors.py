import itertools

from app.services import customer_colors
from app.services.customer_colors import (
    COLOR_CHOICES,
    LINE_COLORS,
    MIN_CONTRAST,
    MIN_CUSTOMER_DISTANCE,
    MIN_LINE_DISTANCE,
    color_distance,
    color_problem,
    contrast_on_white,
    pick_color,
)


# ---- The allowed set -------------------------------------------------------------


def test_every_choice_reads_on_the_white_chart_panel():
    for color in COLOR_CHOICES:
        assert contrast_on_white(color) >= MIN_CONTRAST, color


def test_no_choice_looks_like_a_forecast_line():
    for color, line in itertools.product(COLOR_CHOICES, LINE_COLORS):
        assert color_distance(color, line) >= MIN_LINE_DISTANCE, (color, line)


def test_no_two_choices_look_alike():
    for a, b in itertools.combinations(COLOR_CHOICES, 2):
        assert color_distance(a, b) >= MIN_CUSTOMER_DISTANCE, (a, b)


def test_choices_are_uppercase_hex_and_unique():
    assert len(set(COLOR_CHOICES)) == len(COLOR_CHOICES)
    for color in COLOR_CHOICES:
        assert color == color.upper() and len(color) == 7 and color.startswith("#")


# ---- pick_color ----------------------------------------------------------------


def test_a_first_customer_gets_the_choice_farthest_from_the_lines():
    best = max(COLOR_CHOICES, key=lambda c: min(color_distance(c, line) for line in LINE_COLORS))
    assert pick_color([]) == best


def test_a_new_customer_never_gets_a_taken_colour():
    taken = list(COLOR_CHOICES[:5])
    assert pick_color(taken) not in taken


def test_the_pick_is_the_same_for_the_same_customers():
    taken = ["#7A70B8", "#2E7BA6"]
    assert pick_color(taken) == pick_color(list(reversed(taken)))


def test_taken_colours_are_matched_whatever_their_case():
    taken = [color.lower() for color in COLOR_CHOICES[:-1]]
    assert pick_color(taken) == COLOR_CHOICES[-1]


def test_once_every_choice_is_taken_a_free_allowed_colour_is_still_found():
    color = pick_color(list(COLOR_CHOICES))
    assert color not in COLOR_CHOICES
    assert contrast_on_white(color) >= MIN_CONTRAST
    assert all(color_distance(color, line) >= MIN_LINE_DISTANCE for line in LINE_COLORS)


# ---- color_problem -------------------------------------------------------------


def test_a_choice_free_of_other_customers_is_accepted():
    assert color_problem("#7A70B8", {"NHG": "#2E7BA6"}) is None


def test_a_colour_too_light_for_the_charts_is_refused():
    assert "too light" in color_problem("#F0F0F0", {})


def test_a_forecast_line_colour_is_refused():
    assert "forecast line" in color_problem("#0D9488", {})


def test_a_colour_like_another_customers_is_refused_naming_them():
    assert color_problem("#7B70B8", {"FairPrice": "#7A70B8"}) == (
        "This colour looks too much like FairPrice's. Pick another one."
    )


def test_line_colours_match_the_frontend_series():
    # The Forecast page's own lines (frontend forecastView FORECAST_SERIES).
    for color in ("#E8922A", "#7C3AED", "#0D9488"):
        assert color in customer_colors.LINE_COLORS
