import pytest
from datetime import date

from app.services import inventory_calc as calc


def D(year, month):
    return date(year, month, 1)


def _metrics(opening=None, sell_in=0, sell_out=0, blocks=None):
    values = {"sell_in": sell_in, "sell_out_base": sell_out}
    if opening is not None:
        values["opening_inventory"] = opening
    if blocks is not None:
        values["sell_out_building_blocks"] = blocks
    return values


# ---- build_monthly_series -----------------------------------------------------


def test_ending_stock_chains_from_the_previous_months_ending_stock():
    series = calc.build_monthly_series(
        {
            D(2025, 1): _metrics(opening=0, sell_in=496, sell_out=353),
            D(2025, 2): _metrics(opening=143, sell_in=632, sell_out=418),
        }
    )

    assert [r["ending_stock"] for r in series] == [143, 357]
    assert [r["opening_stock"] for r in series] == [0, 143]


def test_first_month_is_seeded_from_its_own_opening_inventory():
    series = calc.build_monthly_series({D(2025, 1): _metrics(opening=100, sell_in=50, sell_out=20)})

    assert series[0]["opening_stock"] == 100
    assert series[0]["ending_stock"] == 130


def test_first_month_without_an_opening_starts_from_zero():
    series = calc.build_monthly_series({D(2025, 1): _metrics(sell_in=10, sell_out=4)})

    assert series[0]["opening_stock"] == 0
    assert series[0]["ending_stock"] == 6


def test_a_stored_opening_on_a_later_month_does_not_override_the_chain():
    series = calc.build_monthly_series(
        {
            D(2025, 1): _metrics(opening=0, sell_in=100, sell_out=40),
            D(2025, 2): _metrics(opening=9999, sell_in=0, sell_out=10),
        }
    )

    assert series[1]["opening_stock"] == 60
    assert series[1]["ending_stock"] == 50


def test_sell_out_includes_building_blocks():
    series = calc.build_monthly_series(
        {D(2026, 7): _metrics(opening=732, sell_in=504, sell_out=495.6, blocks=79)}
    )

    assert series[0]["sell_out"] == 574.6
    assert series[0]["ending_stock"] == 661.4


def test_a_missing_sell_in_counts_as_zero():
    series = calc.build_monthly_series({D(2025, 1): {"sell_out_base": 30, "opening_inventory": 100}})

    assert series[0]["sell_in"] == 0
    assert series[0]["ending_stock"] == 70


def test_a_month_with_no_data_between_two_others_carries_stock_with_zero_movement():
    series = calc.build_monthly_series(
        {
            D(2025, 1): _metrics(opening=0, sell_in=100, sell_out=10),
            D(2025, 3): _metrics(sell_in=0, sell_out=20),
        }
    )

    assert [r["month"] for r in series] == [D(2025, 1), D(2025, 2), D(2025, 3)]
    assert series[1]["has_data"] is False
    assert series[1]["ending_stock"] == 90
    assert series[2]["ending_stock"] == 70


def test_a_skus_series_can_be_extended_so_it_keeps_showing_the_stock_it_holds():
    series = calc.build_monthly_series(
        {D(2025, 1): _metrics(opening=0, sell_in=100, sell_out=40)}, through=D(2025, 3)
    )

    assert [r["month"] for r in series] == [D(2025, 1), D(2025, 2), D(2025, 3)]
    assert [r["ending_stock"] for r in series] == [60, 60, 60]
    assert [r["has_data"] for r in series] == [True, False, False]


def test_extending_to_an_earlier_month_changes_nothing():
    series = calc.build_monthly_series({D(2025, 3): _metrics(sell_in=5)}, through=D(2025, 1))

    assert [r["month"] for r in series] == [D(2025, 3)]


def test_no_metrics_gives_an_empty_series():
    assert calc.build_monthly_series({}) == []


def test_ending_stock_can_go_negative_rather_than_being_hidden():
    series = calc.build_monthly_series({D(2025, 1): _metrics(opening=0, sell_in=10, sell_out=30)})

    assert series[0]["ending_stock"] == -20


# ---- DOH -------------------------------------------------------------------------


def _series_with_sell_out(months, sell_out, ending=100):
    return [
        {"month": m, "opening_stock": 0, "sell_in": 0, "sell_out": sell_out, "ending_stock": ending, "has_data": True}
        for m in months
    ]


def test_doh_is_ending_stock_over_average_daily_sell_out_of_the_next_three_months():
    # Feb (28d), Mar (31d), Apr (30d) = 89 days, 890 units -> 10 per day.
    months = [D(2025, m) for m in (1, 2, 3, 4)]
    series = _series_with_sell_out(months, sell_out=0)
    for row in series[1:]:
        row["sell_out"] = {D(2025, 2): 280, D(2025, 3): 310, D(2025, 4): 300}[row["month"]]
    series[0]["ending_stock"] = 200

    rows = calc.add_doh(series, {})

    assert rows[0]["daily_sell_out"] == 10
    assert rows[0]["doh"] == 20


def test_a_month_without_data_falls_back_to_the_forecast():
    series = _series_with_sell_out([D(2026, 7)], sell_out=0, ending=300)
    forecast = {D(2026, 8): 310.0, D(2026, 9): 300.0}  # 31 + 30 days, 610 units -> 10/day

    rows = calc.add_doh(series, forecast)

    assert rows[0]["daily_sell_out"] == 10
    assert rows[0]["doh"] == 30


def test_real_sell_out_wins_over_the_forecast_for_the_same_month():
    series = _series_with_sell_out([D(2026, 6), D(2026, 7)], sell_out=620)
    series[0]["ending_stock"] = 310
    forecast = {D(2026, 7): 1.0}

    rows = calc.add_doh(series, forecast)

    assert rows[0]["daily_sell_out"] == 20  # 620 units over July's 31 days
    assert rows[0]["doh"] == 15.5


def test_doh_is_none_when_no_month_in_the_window_has_a_value():
    series = _series_with_sell_out([D(2026, 7)], sell_out=100)

    assert calc.add_doh(series, {})[0]["doh"] is None


def test_doh_is_none_when_forward_sell_out_is_zero():
    series = _series_with_sell_out([D(2026, 6), D(2026, 7)], sell_out=0)

    assert calc.add_doh(series, {})[0]["doh"] is None


def test_a_partly_covered_window_uses_only_the_months_it_has():
    series = _series_with_sell_out([D(2026, 6), D(2026, 7)], sell_out=310, ending=155)

    rows = calc.add_doh(series, {})

    assert rows[0]["daily_sell_out"] == 10  # July only: 310 / 31
    assert rows[0]["doh"] == 15.5


# ---- combined_doh -----------------------------------------------------------------


def test_combined_doh_is_total_stock_over_total_daily_sell_out():
    rows = [
        {"ending_stock": 100, "daily_sell_out": 5},
        {"ending_stock": 200, "daily_sell_out": 5},
    ]

    assert calc.combined_doh(rows) == 30


def test_combined_doh_ignores_skus_without_a_daily_rate():
    rows = [
        {"ending_stock": 100, "daily_sell_out": 10},
        {"ending_stock": 9999, "daily_sell_out": None},
    ]

    assert calc.combined_doh(rows) == 10


def test_combined_doh_is_none_when_nothing_is_measurable():
    assert calc.combined_doh([{"ending_stock": 5, "daily_sell_out": None}]) is None


# ---- thresholds -------------------------------------------------------------------


def test_band_is_target_minus_and_plus_five():
    assert calc.threshold_band(30) == (25, 35)


def test_status_is_within_at_both_band_edges():
    assert calc.threshold_status(25, 30) == "within"
    assert calc.threshold_status(35, 30) == "within"


def test_status_flags_below_min_and_above_max():
    assert calc.threshold_status(24.9, 30) == "below_min"
    assert calc.threshold_status(35.1, 30) == "above_max"


def test_status_is_none_without_a_doh():
    assert calc.threshold_status(None, 30) is None


# ---- sell-in plan -----------------------------------------------------------------

# Aug 310, Sep 300 (30d), Oct 310 (31d), Nov 300 (30d): Sep-Nov is 910 units over 91 days = 10 a day.
FORECAST = {D(2026, 8): 310.0, D(2026, 9): 300.0, D(2026, 10): 310.0, D(2026, 11): 300.0}


def _plan(opening, forecast=FORECAST, months=3, target=10, first=D(2026, 8), shipped=None, pack_size=1):
    return calc.build_sell_in_plan(
        opening, first, months, forecast, lambda month: target, shipped, pack_size=pack_size
    )


def test_the_daily_rate_looks_at_the_months_after_the_one_being_planned():
    assert calc.forward_forecast_daily(FORECAST, D(2026, 8)) == 10  # Sep + Oct + Nov, not August


def test_the_daily_rate_ignores_months_with_no_forecast():
    assert calc.forward_forecast_daily(FORECAST, D(2026, 10)) == 300 / 30  # only November follows


def test_the_last_forecast_month_uses_its_own_rate():
    assert calc.forward_forecast_daily({D(2026, 8): 310.0}, D(2026, 8)) == 10


def test_no_forecast_means_no_daily_rate():
    assert calc.forward_forecast_daily({}, D(2026, 8)) is None


def test_sell_in_covers_the_months_sales_and_leaves_the_stock_needed_at_month_end():
    # 310 to sell in August, 10 days x 10 a day = 100 to hold at the end; 50 in hand.
    august = _plan(50)[0]

    assert august["stock_needed"] == 100
    assert august["recommended_sell_in"] == 360  # 310 + 100 - 50
    assert august["projected_ending_stock"] == 100


def test_days_of_holding_after_sell_in_is_measured_at_month_end():
    august = _plan(50)[0]

    assert august["doh_after_sell_in"] == 10  # the 100 left at month end, at 10 a day


def test_stock_already_above_the_need_recommends_zero_and_keeps_the_surplus():
    august = _plan(1000)[0]

    assert august["recommended_sell_in"] == 0
    assert august["projected_ending_stock"] == 690
    assert august["doh_after_sell_in"] == 69


def test_recommended_sell_in_is_never_negative():
    assert all(row["recommended_sell_in"] >= 0 for row in _plan(5000))


def test_recommended_sell_in_is_rounded_up_to_whole_units():
    forecast = {**FORECAST, D(2026, 8): 310.5}

    august = _plan(50, forecast)[0]

    assert august["recommended_sell_in"] == 361  # 310.5 + 100 - 50 = 360.5


def test_a_month_never_projects_negative_stock():
    assert all(row["projected_ending_stock"] >= 0 for row in _plan(0))


def test_each_month_opens_at_the_previous_projected_ending_stock():
    rows = _plan(1000)

    assert rows[1]["opening_stock"] == rows[0]["projected_ending_stock"]


def test_the_plan_stops_at_the_first_month_without_a_forecast():
    forecast = {D(2026, 8): 310.0, D(2026, 9): 300.0, D(2026, 11): 300.0}

    assert [r["month"] for r in _plan(50, forecast, months=6)] == [D(2026, 8), D(2026, 9)]


def test_the_plan_covers_no_more_months_than_asked_for():
    forecast = {D(2026, m): 300.0 for m in range(8, 13)}

    assert len(_plan(50, forecast, months=2)) == 2


def test_each_month_uses_its_own_target():
    targets = {D(2026, 8): 5, D(2026, 9): 50}

    rows = calc.build_sell_in_plan(0, D(2026, 8), 2, FORECAST, lambda m: targets[m])

    assert rows[0]["target_doh"] == 5
    assert rows[1]["target_doh"] == 50


def test_no_forecast_at_all_gives_an_empty_plan():
    assert _plan(100, {}) == []


# ---- sell-in plan: temporary sell-in --------------------------------------------------


def test_sell_in_already_sent_is_taken_off_what_is_recommended():
    august = _plan(50, shipped={D(2026, 8): 60.0})[0]

    assert august["shipped_so_far"] == 60
    assert august["recommended_sell_in"] == 300  # 360 needed in total, 60 already sent


def test_temporary_sell_in_counts_towards_the_projected_ending_stock():
    august = _plan(50, shipped={D(2026, 8): 60.0})[0]

    assert august["projected_ending_stock"] == 100  # 50 + 60 + 300 - 310, still on target


def test_more_sent_than_needed_recommends_zero_and_keeps_the_surplus():
    august = _plan(50, shipped={D(2026, 8): 500.0})[0]

    assert august["recommended_sell_in"] == 0
    assert august["projected_ending_stock"] == 240  # 50 + 500 - 310


def test_a_shipment_in_one_month_carries_into_the_next_months_opening():
    rows = _plan(50, shipped={D(2026, 8): 500.0})

    assert rows[1]["opening_stock"] == 240


def test_without_temporary_sell_in_the_plan_is_unchanged():
    assert _plan(50, shipped={}) == _plan(50)
    assert _plan(50)[0]["shipped_so_far"] == 0


# ---- sell-in plan: whole cartons --------------------------------------------------------


@pytest.mark.parametrize(
    "product, sku_range, expected",
    [
        ("Aire Adult Pants L", "Aire Adult Diaper Pants", 8),
        ("Aire Ultra Pants XL", "Aire Adult Diaper Ultra Pants", 8),
        ("Aire Ultra Tape S/M", "Aire Adult Diaper Ultra Tape", 12),
        ("Aire Ultra Tape XL", None, 12),
        ("Aire Wipes", None, 1),
    ],
)
def test_pack_size_follows_the_product_type(product, sku_range, expected):
    assert calc.pack_size_for(product, sku_range) == expected


def test_recommended_sell_in_is_rounded_up_to_a_multiple_of_the_pack_size():
    # 310 + 100 - 51 = 359 needed; the next multiple of 8 is 360.
    august = _plan(51, pack_size=8)[0]

    assert august["recommended_sell_in"] == 360
    assert august["recommended_sell_in"] % 8 == 0


def test_tape_rounds_up_to_twelves():
    # 310 + 100 - 53 = 357 needed; the next multiple of 12 is 360.
    august = _plan(53, pack_size=12)[0]

    assert august["recommended_sell_in"] == 360


def test_a_quantity_already_on_a_multiple_is_not_rounded_further():
    assert _plan(50, pack_size=8)[0]["recommended_sell_in"] == 360  # 360 needed, 45 cartons of 8


def test_rounding_up_leaves_the_month_slightly_above_the_target():
    august = _plan(53, pack_size=12)[0]

    assert august["projected_ending_stock"] == 103  # 53 + 360 - 310, against 100 needed


def test_no_sell_in_stays_zero_when_stock_is_enough():
    assert _plan(1000, pack_size=8)[0]["recommended_sell_in"] == 0


def test_the_plan_reports_the_pack_size_it_used():
    assert _plan(50, pack_size=12)[0]["pack_size"] == 12


def test_temporary_sell_in_is_taken_off_before_rounding():
    # 360 needed - 60 sent = 300; the next multiple of 8 is 304.
    august = _plan(50, shipped={D(2026, 8): 60.0}, pack_size=8)[0]

    assert august["recommended_sell_in"] == 304
