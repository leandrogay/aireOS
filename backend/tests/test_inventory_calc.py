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

# Aug (31d) 310, Sep (30d) 300, Oct (31d) 310: 920 units over 92 days = 10 a day.
FORECAST = {D(2026, 8): 310.0, D(2026, 9): 300.0, D(2026, 10): 310.0}


def _plan(opening, forecast=FORECAST, months=3, target=31, first=D(2026, 8), shipped=None):
    return calc.build_sell_in_plan(opening, first, months, forecast, lambda month: target, shipped)


def test_the_daily_rate_includes_the_month_being_planned():
    assert calc.forecast_daily_from(FORECAST, D(2026, 8)) == 10  # Aug + Sep + Oct
    assert calc.forecast_daily_from(FORECAST, D(2026, 9)) == (300 + 310) / 61  # Sep + Oct only


def test_the_daily_rate_ignores_months_with_no_forecast():
    assert calc.forecast_daily_from({D(2026, 8): 310.0}, D(2026, 8)) == 10


def test_no_forecast_means_no_daily_rate():
    assert calc.forecast_daily_from({}, D(2026, 8)) is None


def test_sell_in_tops_stock_up_to_the_target_days_from_the_start_of_the_month():
    # 31 days x 10 a day = 310 needed; 50 in hand -> sell in 260.
    august = _plan(50)[0]

    assert august["stock_needed"] == 310
    assert august["recommended_sell_in"] == 260
    assert august["stock_after_sell_in"] == 310
    assert august["doh_before_sell_in"] == 5  # 50 units at 10 a day, before the sell-in arrives


def test_the_month_end_stock_is_what_is_left_after_the_months_sales():
    august = _plan(50)[0]

    assert august["projected_ending_stock"] == 0  # 310 in stock, 310 forecast to sell
    assert august["shortfall"] == 0


def test_stock_already_above_the_need_recommends_zero_and_keeps_the_surplus():
    august = _plan(1000)[0]

    assert august["recommended_sell_in"] == 0
    assert august["projected_ending_stock"] == 690


def test_recommended_sell_in_is_never_negative():
    assert all(row["recommended_sell_in"] >= 0 for row in _plan(5000))


def test_recommended_sell_in_is_rounded_up_to_whole_units():
    forecast = {D(2026, 8): 310.5, D(2026, 9): 300.0, D(2026, 10): 310.0}

    august = _plan(50, forecast)[0]

    assert august["recommended_sell_in"] == 261  # 31 x 10.0054 = 310.17, less 50 = 260.17


def test_a_target_shorter_than_the_month_leaves_a_shortfall_not_negative_stock():
    # 10 days of stock (100) cannot cover a 310-unit month.
    august = _plan(0, target=10)[0]

    assert august["recommended_sell_in"] == 100
    assert august["projected_ending_stock"] == 0
    assert august["shortfall"] == 210


def test_a_shortfall_is_not_carried_into_the_next_month():
    rows = _plan(0, target=10)

    assert rows[1]["opening_stock"] == 0


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


# ---- sell-in plan: shipped so far -----------------------------------------------------


def test_sell_in_already_shipped_is_taken_off_what_is_still_recommended():
    august = _plan(50, shipped={D(2026, 8): 60.0})[0]

    assert august["shipped_so_far"] == 60
    assert august["recommended_sell_in"] == 200  # 310 needed - 50 in hand - 60 already sent


def test_shipped_units_count_towards_the_stock_after_sell_in():
    august = _plan(50, shipped={D(2026, 8): 60.0})[0]

    assert august["stock_after_sell_in"] == 310  # 50 + 60 + 200, still on target


def test_more_shipped_than_needed_recommends_zero_and_keeps_the_surplus():
    august = _plan(50, shipped={D(2026, 8): 500.0})[0]

    assert august["recommended_sell_in"] == 0
    assert august["projected_ending_stock"] == 240  # 550 in stock, 310 sold


def test_a_shipment_in_one_month_carries_into_the_next_months_opening():
    rows = _plan(50, shipped={D(2026, 8): 500.0})

    assert rows[1]["opening_stock"] == 240


def test_without_shipments_the_plan_is_unchanged():
    assert _plan(50, shipped={}) == _plan(50)
    assert _plan(50)[0]["shipped_so_far"] == 0


def test_days_of_cover_before_sell_in_counts_what_is_already_shipped():
    august = _plan(50, shipped={D(2026, 8): 60.0})[0]

    assert august["doh_before_sell_in"] == 11  # (50 + 60) units at 10 a day


def test_days_of_cover_before_sell_in_can_be_above_the_target():
    august = _plan(1000)[0]

    assert august["doh_before_sell_in"] == 100
    assert august["recommended_sell_in"] == 0
