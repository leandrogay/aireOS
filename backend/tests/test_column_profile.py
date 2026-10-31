"""
Column profiles, repeated groups and the layout fingerprint.

The fingerprint's promise is the one that saves a model call every month: a
file with the same structure -- other months in its headers, an extra outlet
column -- is the same layout.
"""

import pandas as pd

from app.services import column_profile as cp

FAIRPRICE = [
    "SKU No.", "Store Code",
    "SALES | Month 1 | 01-01-2026", "SALES | Month 2 | 01-02-2026",
    "Qty (in EA) | Month 1 | 01-01-2026", "Qty (in EA) | Month 2 | 01-02-2026",
]
SHIFTED = [
    "SKU No.", "Store Code",
    "SALES | Month 1 | 01-02-2026", "SALES | Month 2 | 01-03-2026",
    "Qty (in EA) | Month 1 | 01-02-2026", "Qty (in EA) | Month 2 | 01-03-2026",
]
SHENG_SIONG = ["BusinessDate", "ItemCode", "OUTLET", "2A", "6M_Ecomm", "TC", "Total"]


# ---- Fingerprint ----------------------------------------------------------------

def test_a_file_for_other_months_fingerprints_the_same():
    assert cp.fingerprint(FAIRPRICE) == cp.fingerprint(SHIFTED)


def test_more_months_fingerprint_the_same():
    longer = FAIRPRICE + ["SALES | Month 3 | 01-03-2026", "Qty (in EA) | Month 3 | 01-03-2026"]

    assert cp.fingerprint(FAIRPRICE) == cp.fingerprint(longer)


def test_an_extra_outlet_column_fingerprints_the_same():
    with_outlet = SHENG_SIONG[:-1] + ["TY", "Total"]

    assert cp.fingerprint(SHENG_SIONG) == cp.fingerprint(with_outlet)


def test_weekly_and_monthly_layouts_fingerprint_differently():
    weekly = [column.replace("Month", "Week") for column in FAIRPRICE]

    assert cp.fingerprint(FAIRPRICE) != cp.fingerprint(weekly)


# ---- Groups ------------------------------------------------------------------------

def test_period_columns_are_grouped_with_a_pattern_that_matches_other_months():
    groups = [g for g in cp.detect_column_groups(FAIRPRICE) if g["kind"] == "period"]
    sales = next(g for g in groups if g["columns"][0].startswith("SALES"))

    assert sales["columns"] == FAIRPRICE[2:4]
    assert sales["date_format"] == "%d-%m-%Y"
    assert sales["period_type"] == "month"
    assert pd.Series(SHIFTED).str.contains(sales["select_pattern"]).tolist() == [
        False, False, True, True, False, False,
    ]


def test_a_run_of_outlet_codes_is_a_dimension_group_between_its_neighbours():
    groups = [g for g in cp.detect_column_groups(SHENG_SIONG) if g["kind"] == "dimension"]

    assert groups == [{
        "kind": "dimension",
        "columns": ["2A", "6M_Ecomm", "TC"],
        "after": "OUTLET",
        "before": "Total",
    }]


def test_two_code_like_headers_are_not_a_group():
    assert not [g for g in cp.detect_column_groups(["Item", "A1", "B2", "Qty"]) if g["kind"] == "dimension"]


def test_a_run_of_abbreviated_headers_is_not_a_store_group():
    assert not [g for g in cp.detect_column_groups(["SKU", "UOM", "MCH", "Qty"]) if g["kind"] == "dimension"]


# ---- Profile ----------------------------------------------------------------------------

def test_the_profile_covers_every_row_not_the_first_few():
    frame = pd.DataFrame({"Store Format": ["HYPER"] * 50 + ["FPON"], "Qty": ["-1"] * 10 + ["2"] * 41})

    profile = cp.profile_columns(frame)

    assert "FPON" in profile["Store Format"]["values"]
    assert profile["Qty"]["type"] == "number"
    assert profile["Qty"]["negative_share"] == round(10 / 51, 3)
    assert profile["Qty"]["min"] == -1.0


def test_a_high_cardinality_column_is_sampled_across_the_file():
    frame = pd.DataFrame({"Code": [str(i) for i in range(100)]})

    values = cp.profile_columns(frame)["Code"]["values"]

    assert values[0] == "0" and values[-1] == "99"
    assert len(values) == cp.SPREAD_SIZE


def test_spacer_and_total_columns_are_marked():
    frame = pd.DataFrame({"OUTLET": [None], "Total": ["4"]})

    profile = cp.profile_columns(frame, {"spacer_columns": ["OUTLET"], "total_columns": ["Total"]})

    assert profile["OUTLET"]["role"] == "spacer"
    assert profile["Total"]["role"] == "total"


def test_column_samples_use_distinct_values_instead_of_repeating_first_rows():
    frame = pd.DataFrame({"Store Format": ["FPON", "FPON", "HYPER", "SUPER", "HYPER"]})

    assert cp.column_samples(frame) == {"Store Format": ["FPON", "HYPER", "SUPER"]}


# ---- Groups offered to the reviewer --------------------------------------------

MONTH_NAMED = ["Article", "Net Sales Jan 2026", "Net Sales Feb 2026", "Net Sales Mar 2026", "Remarks"]


def test_month_named_period_columns_are_offered_as_a_group():
    groups = cp.review_column_groups(MONTH_NAMED)

    assert len(groups) == 1
    group = groups[0]
    assert group["columns"] == MONTH_NAMED[1:4]
    assert group["date_format"] == "%b %Y"
    assert group["period_type"] == "month"
    # Next year's file matches the same selector.
    assert pd.Series(["Net Sales Apr 2027", "Remarks"]).str.contains(group["select_pattern"]).tolist() == [True, False]


def test_month_named_groups_leave_the_fingerprint_alone():
    # The fingerprint is built from detect_column_groups, which must not see
    # them: a confirmed mapping for such a layout would stop being found.
    assert cp.detect_column_groups(MONTH_NAMED) == []
    assert cp.fingerprint(MONTH_NAMED) == cp.fingerprint(
        ["Article", "Net Sales Jan 2026", "Net Sales Feb 2026", "Net Sales Mar 2026", "Remarks"]
    )


def test_a_column_already_in_a_dated_group_is_not_offered_twice():
    columns = ["SALES | Month 1 | 01-01-2026 Jan 2026", "SALES | Month 2 | 01-02-2026 Feb 2026"]

    groups = cp.review_column_groups(columns)

    assert len(groups) == 1
    assert groups[0]["template"] == cp.header_template(columns[0])
