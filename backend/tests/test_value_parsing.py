"""
Reading a cell's text as a number or a date.

The promise: the ways retailers write a figure are each read by a fixed rule,
and anything that fits no rule is not a number or a date -- never a guess.
"""

import pandas as pd
import pytest

from app.services import value_parsing as vp


# ---- Numbers ---------------------------------------------------------------------

@pytest.mark.parametrize("text, number", [
    ("1250.5", 1250.5),
    ("1,250.50", 1250.5),
    ("$1,250.50", 1250.5),
    ("S$ 1,250", 1250.0),
    ("SGD 12", 12.0),
    ("12.00 SGD", 12.0),
    ("1 250", 1250.0),
    ("15%", 15.0),
    (".5", 0.5),
    ("1e3", 1000.0),
])
def test_a_figure_is_read_whatever_is_written_around_it(text, number):
    assert vp.read_number(text) == number


@pytest.mark.parametrize("text", ["(120)", "120-", "-120", "−120", "$-120", "($120.00)"])
def test_brackets_and_a_minus_on_either_side_are_negative(text):
    assert vp.read_number(text) == -120.0


@pytest.mark.parametrize("text, number", [("1.250,50", 1250.5), ("3,10", 3.1), ("1.250", 1250.0)])
def test_a_decimal_comma_is_read_when_asked_for(text, number):
    assert vp.read_number(text, decimal=",") == number


@pytest.mark.parametrize("text", ["", "  ", "N/A", "-", "10S", "12 EA", "1,25", "1.250,50", "abc", "12 13"])
def test_text_that_is_not_a_number_reads_as_none(text):
    assert vp.read_number(text) is None


def test_a_column_is_read_cell_by_cell_with_blanks_and_junk_as_nan():
    numbers = vp.read_numbers(pd.Series(["$5.00", None, "N/A", "(2)"], dtype=object))

    assert numbers.tolist()[0] == 5.0 and numbers.tolist()[3] == -2.0
    assert numbers.isna().tolist() == [False, True, True, False]


def test_number_traits_say_how_a_column_writes_its_figures():
    traits = vp.number_traits(["$1,250.50", "$3.00", "($12.00)", "$7.25"])

    assert traits == {
        "decimal": ".",
        "written_with": ["currency", "thousands separators", "negatives in brackets"],
        "unreadable": [],
    }


def test_number_traits_find_the_decimal_comma_and_quote_what_they_cannot_read():
    traits = vp.number_traits([*[f"{n},50" for n in range(1, 20)], "n/a"])

    assert traits["decimal"] == ","
    assert traits["unreadable"] == ["n/a"]


def test_a_column_of_words_has_no_number_traits():
    assert vp.number_traits(["HYPER", "SUPER", "12"]) is None


# ---- Dates -----------------------------------------------------------------------

def test_with_no_format_only_iso_dates_are_read():
    dates = vp.read_dates(pd.Series(["2026-08-31", "2026-08-31 10:15:00", "31/08/2026", None], dtype=object))

    assert dates.notna().tolist() == [True, True, False, False]
    assert dates.iloc[0] == pd.Timestamp("2026-08-31")


def test_an_ambiguous_date_is_never_guessed_at():
    # 1 February to one reader, 2 January to another.
    assert vp.read_dates(pd.Series(["01/02/2026"], dtype=object)).isna().all()


def test_a_format_reads_the_dates_written_that_way_and_nothing_else():
    dates = vp.read_dates(pd.Series(["01/02/2026", "31/12/2025", "2026-01-01"], dtype=object), "%d/%m/%Y")

    assert dates.iloc[0] == pd.Timestamp("2026-02-01")
    assert dates.iloc[1] == pd.Timestamp("2025-12-31")
    assert pd.isna(dates.iloc[2])


def test_sept_is_read_as_september():
    assert vp.read_dates(pd.Series(["5 Sept 2026"], dtype=object), "%d %b %Y").iloc[0] == pd.Timestamp("2026-09-05")


def test_an_excel_day_count_is_read_as_its_date():
    assert vp.read_dates(pd.Series(["46235"], dtype=object), vp.EXCEL_SERIAL).iloc[0] == pd.Timestamp("2026-08-01")


def test_a_format_that_is_not_one_reads_nothing():
    assert vp.read_dates(pd.Series(["2026-08-01"], dtype=object), "%Q").isna().all()


def test_date_formats_offers_the_format_that_reads_every_value():
    assert vp.date_formats(["31/12/2025", "01/02/2026"]) == ["%d/%m/%Y"]


def test_date_formats_offers_both_orders_when_the_values_do_not_say():
    assert vp.date_formats(["01/02/2026", "03/04/2026"]) == ["%d/%m/%Y", "%m/%d/%Y"]


def test_iso_dates_and_words_need_no_format():
    assert vp.date_formats(["2026-01-02"]) == []
    assert vp.date_formats(["HYPER", "SUPER"]) == []
