import datetime

import pandas as pd
import pytest

from app.services import pl_forecast
from app.services.pl_forecast import ForecastParams

RUN_JUNE = datetime.date(2026, 6, 30)
RUN_JULY = datetime.date(2026, 7, 31)


def _actual(month, units, promo=None, product="Aire Adult Pants L"):
    return {
        "month_year": f"{month}-01", "forecast_generated_at": None, "customer_id": 1,
        "customer_name": "fairprice", "product_name": product, "promo_type": promo,
        "quantity_units": units, "revenue": units * 10.0,
        "predicted_quantity_units": None, "predicted_revenue": None,
    }


def _forecast(month, run_date, promo=None, predicted=None, product="Aire Adult Pants L", run_type="rolling",
              tier=0):
    return {
        "month_year": f"{month}-01", "forecast_generated_at": run_date, "run_type": run_type, "tier": tier,
        "customer_id": 1, "customer_name": "fairprice", "product_name": product, "promo_type": promo,
        "quantity_units": None, "revenue": None,
        "predicted_quantity_units": predicted, "predicted_revenue": None,
    }


def _rows(records):
    return pl_forecast.normalise_rows(pd.DataFrame(records))


def _flat_history(start, months, units):
    first = pd.Period(start, "M")
    return [_actual(str(first + offset), units) for offset in range(months)]


def _weeks(starts, units=10):
    return pd.DataFrame({
        "period_start": starts, "customer_name": "fairprice",
        "product_name": "Aire Adult Pants L", "quantity_units": units, "revenue": units * 10.0,
    })


# ---- Parameters ----------------------------------------------------------------

def test_ly_weight_outside_zero_to_one_raises():
    with pytest.raises(ValueError):
        ForecastParams(ly_weight=1.5)


def test_negative_uplift_override_raises():
    with pytest.raises(ValueError):
        pl_forecast.validate_uplift_override({"bundle": -0.1})


# ---- Actuals from sell-out weeks ---------------------------------------------------

def test_month_without_its_last_week_is_not_complete():
    # Weeks start Thursdays; data stops at 13 Aug, so August isn't complete yet.
    weeks = _weeks(["2026-07-02", "2026-07-09", "2026-07-16", "2026-07-23", "2026-07-30",
                    "2026-08-06", "2026-08-13"])

    monthly = pl_forecast.complete_months(weeks)

    assert [str(month) for month in monthly["month_year"]] == ["2026-07"]
    assert monthly["quantity_units"].iloc[0] == 50


def test_first_month_starting_mid_month_is_not_complete():
    weeks = _weeks(["2024-07-18", "2024-07-25", "2024-08-01", "2024-08-08",
                    "2024-08-15", "2024-08-22", "2024-08-29"])

    monthly = pl_forecast.complete_months(weeks)

    assert [str(month) for month in monthly["month_year"]] == ["2024-08"]


def test_diff_actuals_returns_only_changed_and_new_months():
    rows = _rows([_actual("2026-06", 100), _actual("2026-07", 50)])
    monthly = pd.DataFrame({
        "product_name": "Aire Adult Pants L", "customer_name": "fairprice",
        "month_year": pd.PeriodIndex(["2026-06", "2026-07", "2026-08"], freq="M"),
        "quantity_units": [100.0, 80.0, 90.0], "revenue": [1000.0, 800.0, 900.0],
    })

    changes = pl_forecast.diff_actuals(rows, monthly)

    assert dict(zip(changes["month_year"].astype(str), changes["change"])) == {
        "2026-07": "50 -> 80", "2026-08": "new month",
    }


def test_new_actual_month_copies_promo_already_planned_on_a_forecast_row():
    rows = _rows([_actual("2026-07", 50), _forecast("2026-08", RUN_JULY, promo="bundle")])
    monthly = pd.DataFrame({
        "product_name": ["Aire Adult Pants L"], "customer_name": ["fairprice"],
        "month_year": pd.PeriodIndex(["2026-08"], freq="M"),
        "quantity_units": [90.0], "revenue": [900.0],
    })

    changes = pl_forecast.diff_actuals(rows, monthly)

    assert changes["promo_type"].tolist() == ["bundle"]


def test_applying_changes_then_diffing_again_is_a_no_op():
    rows = _rows([_actual("2026-06", 100), _actual("2026-07", 50)])
    monthly = pd.DataFrame({
        "product_name": "Aire Adult Pants L", "customer_name": "fairprice",
        "month_year": pd.PeriodIndex(["2026-07", "2026-08"], freq="M"),
        "quantity_units": [80.0, 90.0], "revenue": [800.0, 900.0],
    })

    updated = pl_forecast.apply_actual_changes(rows, pl_forecast.diff_actuals(rows, monthly))

    assert pl_forecast.diff_actuals(updated, monthly).empty


def test_suspiciously_low_latest_month_is_ignored():
    rows = _rows(_flat_history("2026-01", 6, 100) + [_actual("2026-07", 20)])

    actuals, ignored = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    assert str(actuals["month_year"].max()) == "2026-06"
    assert ignored[0].startswith("2026-07")


# ---- Model ------------------------------------------------------------------

def test_uplift_is_median_ratio_to_neighbouring_no_promo_months():
    history = _flat_history("2025-01", 9, 100)
    for month in ("2025-02", "2025-04", "2025-06"):
        history = [_actual(month, 130, promo="bundle") if r["month_year"] == f"{month}-01" else r for r in history]

    uplifts = pl_forecast.estimate_uplifts(_rows(history), ForecastParams())

    assert uplifts["bundle"] == pytest.approx(0.30)


def test_uplift_with_too_few_promo_months_is_zero():
    history = _flat_history("2025-01", 5, 100)
    history[2] = _actual("2025-03", 200, promo="bundle")

    uplifts = pl_forecast.estimate_uplifts(_rows(history), ForecastParams())

    assert uplifts["bundle"] == 0.0


def test_sku_under_a_year_old_uses_run_rate_only():
    history = _rows([_actual("2026-04", 90), _actual("2026-05", 100), _actual("2026-06", 110)])

    forecast = pl_forecast.forecast_sku(history.set_index("month_year"), {}, [pd.Period("2026-07", "M")],
                                        {}, ForecastParams())

    assert forecast["total_sell_out"].iloc[0] == pytest.approx(100)
    assert forecast["base_method"].iloc[0] == "runrate"


def test_base_blends_last_year_times_growth_with_run_rate():
    # Last year flat 100, recent quarter 120 => growth 1.2, run-rate 120.
    history = _flat_history("2025-01", 15, 100) + _flat_history("2026-04", 3, 120)
    history = _rows(history).set_index("month_year")

    forecast = pl_forecast.forecast_sku(history, {}, [pd.Period("2026-07", "M")], {}, ForecastParams())

    # 0.5 x (100 x 1.2) + 0.5 x 120
    assert forecast["total_sell_out"].iloc[0] == pytest.approx(120)
    assert forecast["base_method"].iloc[0] == "ly_x_growth+runrate"


def test_promo_month_adds_building_blocks_on_top_of_base():
    history = _rows(_flat_history("2026-04", 3, 100)).set_index("month_year")
    july = pd.Period("2026-07", "M")

    forecast = pl_forecast.forecast_sku(history, {july: "bundle"}, [july], {"bundle": 0.25}, ForecastParams())

    assert forecast["sell_out_building_blocks"].iloc[0] == pytest.approx(25)
    assert forecast["total_sell_out"].iloc[0] == pytest.approx(125)


# ---- Forecast runs -------------------------------------------------------------

def test_new_run_is_added_when_a_newer_month_is_complete():
    rows = _rows(_flat_history("2026-04", 4, 100) + [_forecast("2026-07", RUN_JUNE, promo="carton")])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    new_run = pl_forecast.next_run(rows, actuals)

    assert set(new_run["forecast_generated_at"]) == {RUN_JULY}
    assert len(new_run) == pl_forecast.HORIZON_MONTHS
    assert str(new_run["month_year"].min()) == "2026-08"


def test_no_new_run_when_latest_run_already_covers_latest_actual():
    rows = _rows(_flat_history("2026-04", 3, 100) + [_forecast("2026-07", RUN_JUNE)])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    assert pl_forecast.next_run(rows, actuals).empty


def test_default_recomputes_latest_and_blank_runs_but_freezes_the_rest():
    rows = _rows([
        _forecast("2026-07", RUN_JUNE, predicted=10.0),
        _forecast("2026-08", datetime.date(2026, 5, 31), predicted=None),
        _forecast("2026-08", RUN_JULY, predicted=10.0),
    ])

    assert pl_forecast.runs_to_compute(rows, recompute_all=False) == [datetime.date(2026, 5, 31), RUN_JULY]
    assert pl_forecast.runs_to_compute(rows, recompute_all=True) == [datetime.date(2026, 5, 31), RUN_JUNE, RUN_JULY]


def test_run_ignores_actuals_after_its_own_month():
    rows = _rows(_flat_history("2026-03", 4, 100) + [_actual("2026-07", 100_000)]
                 + [_forecast("2026-07", RUN_JUNE)])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(partial_ratio=0), set())

    forecast, _ = pl_forecast.forecast_runs(rows, actuals, {}, [RUN_JUNE], ForecastParams(), {})

    assert forecast["predicted_quantity_units"].tolist() == [100.0]


def test_next_run_ignores_a_yearly_runs_date():
    # A yearly run dated after the rolling run must not fool next_run into
    # thinking a rolling run already covers the latest actual month.
    rows = _rows(_flat_history("2026-04", 4, 100) + [
        _forecast("2026-07", RUN_JUNE, promo="carton"),
        _forecast("2027-01", datetime.date(2026, 12, 31), run_type="yearly"),
    ])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    new_run = pl_forecast.next_run(rows, actuals)

    assert set(new_run["forecast_generated_at"]) == {RUN_JULY}
    assert set(new_run["run_type"]) == {"rolling"}


def test_next_yearly_run_generates_baseline_for_year_after_a_complete_december():
    rows = _rows(_flat_history("2025-01", 12, 100))  # Jan..Dec 2025
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    yearly = pl_forecast.next_yearly_run(rows, actuals)

    assert set(yearly["forecast_generated_at"]) == {datetime.date(2025, 12, 31)}
    assert set(yearly["run_type"]) == {"yearly"}
    assert str(yearly["month_year"].min()) == "2026-01"
    assert str(yearly["month_year"].max()) == "2026-12"
    assert len(yearly) == 12


def test_next_yearly_run_is_empty_when_prior_december_is_incomplete():
    rows = _rows(_flat_history("2025-01", 11, 100))  # Jan..Nov 2025, no December

    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    assert pl_forecast.next_yearly_run(rows, actuals).empty


def test_next_yearly_run_is_empty_once_that_years_baseline_exists():
    rows = _rows(
        _flat_history("2025-01", 12, 100)
        + [_forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", predicted=90.0)]
    )
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    assert pl_forecast.next_yearly_run(rows, actuals).empty


def test_next_yearly_run_skips_a_year_that_already_has_a_baseline():
    rows = _rows(
        _flat_history("2025-01", 24, 100)  # Jan 2025 .. Dec 2026, both Decembers complete
        + [_forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", predicted=90.0)]
    )
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    yearly = pl_forecast.next_yearly_run(rows, actuals)

    assert set(yearly["forecast_generated_at"]) == {datetime.date(2026, 12, 31)}
    assert str(yearly["month_year"].min()) == "2027-01"


def test_next_yearly_run_adds_every_missing_year_in_one_call():
    # Three complete Decembers with no yearly baseline at all yet -- a
    # one-time backfill against existing history should add 2026, 2027 AND
    # 2028's baselines in this single call, not gate behind repeated calls.
    rows = _rows(_flat_history("2025-01", 36, 100))  # Jan 2025 .. Dec 2027
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    yearly = pl_forecast.next_yearly_run(rows, actuals)

    assert set(yearly["forecast_generated_at"]) == {
        datetime.date(2025, 12, 31), datetime.date(2026, 12, 31), datetime.date(2027, 12, 31),
    }
    by_run = yearly.groupby("forecast_generated_at")["month_year"]
    assert str(by_run.min()[datetime.date(2025, 12, 31)]) == "2026-01"
    assert str(by_run.max()[datetime.date(2025, 12, 31)]) == "2026-12"
    assert str(by_run.min()[datetime.date(2027, 12, 31)]) == "2028-01"
    assert str(by_run.max()[datetime.date(2027, 12, 31)]) == "2028-12"


def test_runs_to_compute_ignores_yearly_runs_even_under_recompute_all():
    rows = _rows([
        _forecast("2026-07", RUN_JUNE, predicted=10.0),
        _forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", predicted=90.0),
    ])

    assert pl_forecast.runs_to_compute(rows, recompute_all=False) == [RUN_JUNE]
    assert pl_forecast.runs_to_compute(rows, recompute_all=True) == [RUN_JUNE]


def test_yearly_runs_to_compute_only_returns_blank_ones():
    rows = _rows([
        _forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", predicted=None),
        _forecast("2027-01", datetime.date(2026, 12, 31), run_type="yearly", predicted=90.0),
        _forecast("2026-07", RUN_JUNE, predicted=None),
    ])

    assert pl_forecast.yearly_runs_to_compute(rows) == [datetime.date(2025, 12, 31)]


# ---- Tier 0 / Tier 1 -------------------------------------------------------------

def test_missing_tier_defaults_to_zero():
    rows = _rows([{
        "month_year": "2026-07-01", "forecast_generated_at": RUN_JUNE, "customer_id": 1,
        "customer_name": "fairprice", "product_name": "Aire Adult Pants L", "promo_type": None,
        "quantity_units": None, "revenue": None, "predicted_quantity_units": None, "predicted_revenue": None,
    }])

    assert rows["tier"].iloc[0] == 0


def test_next_run_ignores_a_tier_1_row_sharing_its_target_date():
    rows = _rows(_flat_history("2026-04", 4, 100) + [
        _forecast("2026-08", RUN_JULY, tier=1),
    ])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    new_run = pl_forecast.next_run(rows, actuals)

    assert set(new_run["forecast_generated_at"]) == {RUN_JULY}
    assert set(new_run["tier"]) == {0}


def test_next_yearly_run_ignores_a_tier_1_row_sharing_its_target_year():
    rows = _rows(_flat_history("2025-01", 12, 100) + [
        _forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", tier=1, predicted=90.0),
    ])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    yearly = pl_forecast.next_yearly_run(rows, actuals)

    assert set(yearly["forecast_generated_at"]) == {datetime.date(2025, 12, 31)}
    assert set(yearly["tier"]) == {0}


def test_runs_to_compute_never_surfaces_a_tier_1_row():
    rows = _rows([
        _forecast("2026-07", RUN_JUNE, predicted=10.0, tier=0),
        _forecast("2026-08", RUN_JULY, predicted=None, tier=1),
    ])

    assert pl_forecast.runs_to_compute(rows, recompute_all=False) == [RUN_JUNE]
    assert pl_forecast.runs_to_compute(rows, recompute_all=True) == [RUN_JUNE]


def test_yearly_runs_to_compute_never_surfaces_a_tier_1_row():
    rows = _rows([
        _forecast("2026-01", datetime.date(2025, 12, 31), run_type="yearly", predicted=None, tier=0),
        _forecast("2027-01", datetime.date(2026, 12, 31), run_type="yearly", predicted=None, tier=1),
    ])

    assert pl_forecast.yearly_runs_to_compute(rows) == [datetime.date(2025, 12, 31)]


def test_forecast_runs_output_carries_tier_through():
    rows = _rows(_flat_history("2026-04", 4, 100) + [_forecast("2026-08", RUN_JULY, tier=0)])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    forecast, _ = pl_forecast.forecast_runs(rows, actuals, {}, [RUN_JULY], ForecastParams(), {})

    assert set(forecast["tier"]) == {0}


def test_predicted_revenue_is_units_times_list_price_and_blank_without_one():
    rows = _rows(_flat_history("2026-04", 3, 100) + [
        _forecast("2026-07", RUN_JUNE),
        _actual("2026-06", 40, product="Aire Ultra Tape L"),
        _forecast("2026-07", RUN_JUNE, product="Aire Ultra Tape L"),
    ])
    actuals, _ = pl_forecast.usable_actuals(rows, ForecastParams(), set())

    forecast, _ = pl_forecast.forecast_runs(rows, actuals, {"Aire Adult Pants L": 14.0}, [RUN_JUNE],
                                            ForecastParams(), {})

    revenue = dict(zip(forecast["product_name"], forecast["predicted_revenue"]))
    assert revenue["Aire Adult Pants L"] == 1400.0
    assert pd.isna(revenue["Aire Ultra Tape L"])
