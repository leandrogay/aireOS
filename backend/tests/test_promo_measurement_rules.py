from datetime import date
from decimal import Decimal

import pytest

from app.services.settings import promo_measurement_rules as m
from app.services.settings import promo_uplift_rules as rules


DISCOUNTS = {"pct_off_20": Decimal("20"), "pct_off_30": Decimal("30"), "b1g1": Decimal("50")}


def _months(year, first, last):
    return [date(year, month, 1) for month in range(first, last + 1)]


def _promo(start, end, key, promo_type="monthly", stores=("A",), voucher=0):
    return {
        "period_start": start,
        "period_end": end,
        "promo_type": promo_type,
        "mechanic_key": key,
        "voucher": voucher,
        "stores": set(stores),
    }


# ---- effective_discount and labels (promo_uplift_rules) ----------------------------


@pytest.mark.parametrize(
    "key, discount",
    [
        ("pct_off_30", Decimal("30")),
        ("b2_pct_off_25", Decimal("25")),
        ("b1g1", Decimal("50")),
        ("b2g1", Decimal("33.3")),
        ("b3g1", Decimal("25")),
        ("voucher", None),
        ("unknown", None),
    ],
)
def test_effective_discount_comes_from_the_key(key, discount):
    assert rules.effective_discount(key) == discount


def test_a_key_gets_its_standard_label():
    assert rules.label_for_key("pct_off_35") == "35% Off"
    assert rules.label_for_key("b2_pct_off_25") == "Buy 2 Get 25% Off"
    assert rules.label_for_key("b3g1") == "Buy 3 Get 1 Free"


# ---- anchor: store weights and past months -----------------------------------------


def test_a_promotion_in_small_stores_barely_moves_the_month():
    # Store A makes 90% of sales on 20% Off; store B (10%) runs 30% Off.
    promotions = [
        _promo(date(2026, 6, 1), date(2026, 6, 30), "pct_off_20", stores=("A",)),
        _promo(date(2026, 6, 1), date(2026, 6, 30), "pct_off_30", stores=("B",)),
    ]

    monthly = rules.monthly_discounts(promotions, DISCOUNTS, store_weights={"A": 0.9, "B": 0.1})

    assert monthly[date(2026, 6, 1)] == Decimal("21")


def test_months_from_before_onwards_are_left_out():
    promotions = [
        _promo(date(2026, 9, 1), date(2026, 9, 30), "pct_off_20"),
        _promo(date(2026, 11, 1), date(2026, 11, 30), "pct_off_30"),
    ]

    monthly = rules.monthly_discounts(promotions, DISCOUNTS, before=date(2026, 10, 1))

    assert list(monthly) == [date(2026, 9, 1)]


# ---- store weights and exposure ------------------------------------------------------


def test_store_weights_follow_sales_and_fall_back_to_equal_shares():
    assert m.store_weights({"A": 30, "B": 10}, {"A", "B"}) == {"A": 0.75, "B": 0.25}
    assert m.store_weights({}, {"A", "B"}) == {"A": 0.5, "B": 0.5}
    assert m.store_weights({}, set()) == {}


def test_a_side_offer_on_a_third_of_the_month_is_a_third_of_its_exposure():
    promotions = [
        _promo(date(2026, 6, 1), date(2026, 6, 30), "pct_off_20"),
        _promo(date(2026, 6, 1), date(2026, 6, 10), "b1g1", promo_type="side_offer"),
    ]

    exposure = m.exposures(promotions, DISCOUNTS, {"A": 1.0}, [date(2026, 6, 1)])[date(2026, 6, 1)]

    assert exposure["b1g1"] == pytest.approx(10 / 30)
    assert exposure["pct_off_20"] == pytest.approx(20 / 30)


def test_voucher_exposure_counts_any_promotion_carrying_a_voucher():
    promotions = [_promo(date(2026, 6, 1), date(2026, 6, 15), "pct_off_20", voucher=1)]

    exposure = m.exposures(promotions, DISCOUNTS, {"A": 1.0}, [date(2026, 6, 1)])[date(2026, 6, 1)]

    assert exposure[rules.VOUCHER_KEY] == pytest.approx(0.5)


def test_usual_reach_is_the_median_month_and_relative_exposure_is_capped():
    rows = [{"pct_off_20": 0.67}, {"pct_off_30": 0.65, "voucher": 0.6}, {"pct_off_20": 0.70}, {}]

    reach = m.usual_reach(rows)

    assert reach == pytest.approx(0.67)
    assert m.relative({"pct_off_20": 0.70, "b1g1": 0.034}, reach) == {
        "pct_off_20": 1.0,
        "b1g1": pytest.approx(0.034 / 0.67),
    }
    assert m.usual_reach([]) == 1.0


# ---- trend ----------------------------------------------------------------------------


def _growing():
    # Worked check (a): 12 months, +20 a month from 1,000.
    return {month: 1000 + 20 * i for i, month in enumerate(_months(2025, 1, 12))}


def test_a_straight_line_series_has_every_ratio_at_one():
    ratios, method = m.trend_ratios(_growing(), min_months=6)

    assert method == "trend"
    assert all(ratio == pytest.approx(1.0) for ratio in ratios.values())


def test_short_series_use_the_flat_average():
    ratios, method = m.trend_ratios({date(2026, 6, 1): 90, date(2026, 7, 1): 110}, min_months=6)

    assert method == "flat"
    assert ratios == {date(2026, 6, 1): 0.9, date(2026, 7, 1): 1.1}


def test_no_sales_gives_no_ratios():
    assert m.trend_ratios({date(2026, 6, 1): 0}, min_months=6) == ({}, "flat")


# ---- fit_uplifts: worked checks ----------------------------------------------------------


def test_worked_check_a_growth_is_not_mistaken_for_a_promotion():
    months = _months(2025, 1, 12)
    exposure = {month: ({"pct_off_30": 1.0} if month.month >= 9 else {}) for month in months}

    trend = m.fit_uplifts(m.trend_ratios(_growing(), 6)[0], exposure, 0.23)
    flat = m.fit_uplifts(m.trend_ratios(_growing(), 13)[0], exposure, 0.23)

    assert trend["pct_off_30"]["uplift_pct"] == pytest.approx(0.0, abs=1e-9)
    assert flat["pct_off_30"]["uplift_pct"] == pytest.approx(7.2, abs=0.05)


def test_worked_check_b_a_partial_month_is_stored_as_a_full_month():
    # The side-offer month sits 5% above the average month; it ran a third of it.
    months = _months(2026, 1, 3)
    ratios = {months[0]: 0.975, months[1]: 0.975, months[2]: 1.05}
    exposure = {months[2]: {"b1g1": 1 / 3}}

    fit = m.fit_uplifts(ratios, exposure, 0.23)

    assert fit["b1g1"]["uplift_pct"] == pytest.approx(15.0, abs=0.05)
    assert fit["b1g1"]["n"] == pytest.approx(1 / 3)
    # The Scenario builder then applies 2,000 x 15% x 10/30 = 100 units.
    assert 2000 * fit["b1g1"]["uplift_pct"] / 100 * 10 / 30 == pytest.approx(100, abs=0.5)


def test_two_mechanics_that_always_run_together_share_the_effect():
    months = _months(2026, 1, 4)
    ratios = {months[0]: 0.98, months[1]: 0.98, months[2]: 1.02, months[3]: 1.02}
    exposure = {months[2]: {"a": 0.5, "b": 0.5}, months[3]: {"a": 0.5, "b": 0.5}}

    fit = m.fit_uplifts(ratios, exposure, 0.23)

    assert fit["a"]["uplift_pct"] == pytest.approx(fit["b"]["uplift_pct"])
    assert fit["a"]["uplift_pct"] == pytest.approx(2.0, abs=0.05)


def test_a_mechanic_in_every_month_has_no_contrast_and_no_evidence():
    # Sheng Shiong-style: one month, one mechanic.
    assert m.fit_uplifts({date(2026, 6, 1): 1.0}, {date(2026, 6, 1): {"pct_off_30": 1.0}}, 0.23) == {}


def test_exposure_below_the_minimum_is_not_evidence():
    months = _months(2026, 1, 3)
    ratios = {months[0]: 1.0, months[1]: 1.0, months[2]: 1.0}
    exposure = {months[2]: {"pct_off_20": 0.034 / 0.67}}

    assert m.fit_uplifts(ratios, exposure, 0.23) == {}


# ---- shrinkage -----------------------------------------------------------------------------


@pytest.mark.parametrize("n, expected", [(2, 24.4), (10, 34.0), (0, 14.0)])
def test_a_sku_leans_on_the_blended_customer_uplift_when_evidence_is_thin(n, expected):
    assert m.blended_sku_uplift(40, n, 14, 3) == pytest.approx(expected, abs=0.05)


def test_the_blended_customer_uplift_starts_from_the_rule_based_uplift():
    # First 50% Off month measured at +30%, rule-based +10%, k = 3 -> +15%.
    raw, steadied = m.blended_customer_uplift([{"uplift_pct": 30, "n": 1, "volume": 100}], 1, 10, 3)

    assert raw == 30
    assert steadied == pytest.approx(15)


def test_the_customer_raw_value_is_weighted_by_sku_volume():
    skus = [
        {"uplift_pct": 12, "n": 6, "volume": 3000},
        {"uplift_pct": 15, "n": 5, "volume": 2000},
        {"uplift_pct": 40, "n": 2, "volume": 200},
    ]

    raw, _ = m.blended_customer_uplift(skus, 6, 4, 3)

    assert raw == pytest.approx(14.2, abs=0.05)


def test_no_evidence_keeps_the_rule_based_uplift():
    assert m.blended_customer_uplift([], 0, 4, 3) == (None, 4)


# ---- backtest check -------------------------------------------------------------------------


def test_the_backtest_check_is_the_exposure_weighted_error():
    errors = {date(2026, 5, 1): 8.0, date(2026, 6, 1): 10.0, date(2026, 7, 1): -50.0}
    exposure = {date(2026, 5, 1): 1.0, date(2026, 6, 1): 1.0}

    assert m.backtest_check(errors, exposure) == (9.0, 2.0)
    assert m.backtest_check({}, exposure) == (None, 0.0)


@pytest.mark.parametrize(
    "value, check, held",
    [(6.0, -3.0, True), (6.0, 9.0, False), (6.0, -0.5, False), (0.4, -5.0, False), (6.0, None, False)],
)
def test_only_a_clear_opposite_sign_holds_a_value(value, check, held):
    assert m.disagrees(value, check, tolerance=1.0) is held


# ---- fingerprint ----------------------------------------------------------------------------


def test_the_fingerprint_ignores_key_order_and_changes_with_the_data():
    assert m.fingerprint({"a": 1, "b": [1, 2]}) == m.fingerprint({"b": [1, 2], "a": 1})
    assert m.fingerprint({"a": 1}) != m.fingerprint({"a": 2})
