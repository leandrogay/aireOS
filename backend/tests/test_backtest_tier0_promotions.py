import pytest

from scripts.backtest_tier0_promotions import capped, scores


# ---- scores -------------------------------------------------------------------


def test_scores_give_error_and_bias_against_the_actuals():
    rows = [{"actual": 100.0, "tier0": 90.0}, {"actual": 100.0, "tier0": 120.0}]

    result = scores(rows, "tier0")

    assert result["wape"] == pytest.approx(15)
    assert result["bias"] == pytest.approx(5)


# ---- the cap ------------------------------------------------------------------


def test_the_cap_keeps_the_adjusted_value_near_tier0():
    assert capped(180.0, 60.0, 0.35) == pytest.approx(81)
    assert capped(20.0, 60.0, 0.35) == pytest.approx(39)
    assert capped(70.0, 60.0, 0.35) == 70
