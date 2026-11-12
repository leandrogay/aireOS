from datetime import date

import pytest

from app.services.scenario.tier0_split import day_share, month_split, month_uplift, split, tier0_parts


def _promotion(mechanic: str, start: date, end: date) -> dict:
    return {"promotion_mechanic": mechanic, "period_start": start, "period_end": end}


def _uplifts(values: dict[str, float], level: str = "measured"):
    # uplift_for as choose_uplift returns it: a level and a % per mechanic key.
    return lambda key, month: {"level": level, "uplift_pct": values[key]} if key in values else None


# ---- day share ----------------------------------------------------------------


def test_a_whole_month_promotion_counts_in_full():
    assert day_share(_promotion("20% Off", date(2026, 6, 1), date(2026, 6, 30)), date(2026, 6, 1)) == 1


def test_a_side_offer_counts_by_the_days_it_runs():
    assert day_share(_promotion("Buy 2 Get 1", date(2026, 6, 8), date(2026, 6, 14)), date(2026, 6, 1)) == pytest.approx(7 / 30)


def test_a_promotion_outside_the_month_counts_nothing():
    assert day_share(_promotion("20% Off", date(2026, 7, 1), date(2026, 7, 31)), date(2026, 6, 1)) == 0


# ---- what a month carries -----------------------------------------------------


def test_two_promotions_in_a_month_add_up_and_a_voucher_is_left_out():
    promotions = [
        _promotion("20% Off", date(2026, 6, 1), date(2026, 6, 30)),
        _promotion("30% Off", date(2026, 6, 1), date(2026, 6, 15)),
        _promotion("Voucher", date(2026, 6, 1), date(2026, 6, 30)),
    ]

    carried = month_uplift(promotions, date(2026, 6, 1), _uplifts({"pct_off_20": 0.0, "pct_off_30": 6.0}))

    assert carried["uplift"] == pytest.approx(0.06 * 15 / 30)
    assert [p["mechanic"] for p in carried["promotions"]] == ["20% Off", "30% Off"]
    assert carried["missing"] == []


def test_a_promotion_with_no_uplift_is_named_not_guessed():
    carried = month_uplift([_promotion("20% Off", date(2026, 6, 1), date(2026, 6, 30))], date(2026, 6, 1), _uplifts({}))

    assert carried["uplift"] == 0
    assert carried["missing"] == ["20% Off"]


def test_the_month_shows_its_weakest_level():
    promotions = [
        _promotion("20% Off", date(2026, 6, 1), date(2026, 6, 30)),
        _promotion("30% Off", date(2026, 6, 1), date(2026, 6, 30)),
    ]

    def uplift_for(key, month):
        return {"level": "anchor" if key == "pct_off_20" else "placeholder", "uplift_pct": 0.0 if key == "pct_off_20" else 4.0}

    assert month_uplift(promotions, date(2026, 6, 1), uplift_for)["level"] == "placeholder"


# ---- Tier 0 and its split -----------------------------------------------------


def test_tier0_is_built_as_the_view_builds_it():
    series = {date(2025, 6, 1): 100.0, date(2026, 3, 1): 90.0, date(2026, 4, 1): 120.0, date(2026, 5, 1): 96.0}

    parts = tier0_parts(series, latest=date(2026, 5, 1), target=date(2026, 6, 1))

    assert parts["ly_units"] == 100
    assert [month for month, _ in parts["recent"]] == [date(2026, 3, 1), date(2026, 4, 1), date(2026, 5, 1)]
    assert parts["tier0"] == pytest.approx(0.5 * 100 + 0.5 * 102)


def test_a_month_with_no_sales_last_year_uses_the_run_rate_alone():
    parts = tier0_parts({date(2026, 5, 1): 80.0}, latest=date(2026, 5, 1), target=date(2026, 6, 1))

    assert parts["ly_units"] is None
    assert parts["tier0"] == 80


def test_the_baseline_takes_out_what_each_month_carried():
    result = split(110.0, 0.10, [(110.0, 0.10)])

    assert result["baseline"] == pytest.approx(100)
    assert result["carried"] == pytest.approx(10)


def test_the_same_promotion_planned_again_gives_back_tier0():
    result = split(100.0, 0.10, [(90.0, 0.10), (120.0, 0.10), (96.0, 0.10)], target_uplift=0.10)

    assert result["adjusted"] == pytest.approx(result["tier0"])


def test_a_month_split_names_the_promotions_of_every_source_month_and_the_target():
    series = {date(2025, 6, 1): 110.0, date(2026, 5, 1): 110.0}
    promotions = [
        _promotion("30% Off", date(2025, 6, 1), date(2025, 6, 30)),
        _promotion("30% Off", date(2026, 5, 1), date(2026, 5, 31)),
        _promotion("20% Off", date(2026, 6, 1), date(2026, 6, 30)),
    ]
    uplift_for = _uplifts({"pct_off_30": 10.0, "pct_off_20": 0.0})

    row = month_split(series, date(2026, 5, 1), date(2026, 6, 1), lambda month: month_uplift(promotions, month, uplift_for))

    assert (row["tier0"], row["run_rate"], row["baseline"], row["carried"]) == (110, 110, 100, 10)
    assert row["last_year"]["promotions"][0]["mechanic"] == "30% Off"
    assert row["recent"][0]["uplift_pct"] == 10
    assert row["official"]["planned"] is True
    assert row["official"]["promotions"][0]["mechanic"] == "20% Off"


def test_a_series_with_no_run_rate_months_has_no_split():
    assert month_split({date(2025, 1, 1): 50.0}, date(2026, 5, 1), date(2026, 6, 1), lambda month: None) is None
