from datetime import date

from app.services.settings import promo_moment_rules as rules


def _promo(promotion_id, start, end, mechanic="20% Off", promo_type="monthly", customer_id=1, sku="SKU-L"):
    return {
        "customer_id": customer_id,
        "sku": sku,
        "promotion_id": promotion_id,
        "period_start": start,
        "period_end": end,
        "promo_type": promo_type,
        "promotion_mechanic": mechanic,
    }


def _month(promotion_id, month, mechanic="20% Off", **kwargs):
    # A monthly promotion that runs the whole of `month` (first of month).
    end = date(month.year + month.month // 12, month.month % 12 + 1, 1).toordinal() - 1
    return _promo(promotion_id, month, date.fromordinal(end), mechanic, **kwargs)


def _moment(month, mechanic_key, units, customer_id=1, sku="SKU-L"):
    return {
        "customer_id": customer_id,
        "sku": sku,
        "month": month,
        "promotion_id": month.month,
        "mechanic_key": mechanic_key,
        "mechanic_label": mechanic_key,
        "units": units,
    }


JAN, FEB, MAR, APR, MAY = (date(2026, m, 1) for m in range(1, 6))
UNITS = {(1, "SKU-L"): {JAN: 100.0, FEB: 120.0, MAR: 90.0, APR: 110.0, MAY: 100.0}}


# ---- find_moments ------------------------------------------------------------------


def test_a_whole_month_monthly_promotion_alone_is_a_moment():
    moments = rules.find_moments([_month(1, JAN)], UNITS)

    assert [(m["month"], m["mechanic_key"], m["units"]) for m in moments] == [(JAN, "pct_off_20", 100.0)]


def test_a_side_offer_inside_a_monthly_promotion_rules_out_the_month():
    promotions = [_month(1, JAN), _promo(2, date(2026, 1, 3), date(2026, 1, 9), "30% Off", "side_offer")]

    assert rules.find_moments(promotions, UNITS) == []


def test_two_monthly_promotions_in_one_month_rule_it_out():
    promotions = [_month(1, APR, "Buy 2 Get 1 Free"), _month(2, APR, "25%")]

    assert rules.find_moments(promotions, UNITS) == []


def test_a_promotion_over_two_whole_months_is_a_moment_in_each():
    promotion = _promo(1, JAN, date(2026, 2, 28))

    assert [m["month"] for m in rules.find_moments([promotion], UNITS)] == [JAN, FEB]


def test_a_monthly_promotion_that_misses_part_of_the_month_is_not_a_moment():
    promotion = _promo(1, date(2026, 1, 5), date(2026, 1, 31))

    assert rules.find_moments([promotion], UNITS) == []


def test_a_month_without_complete_sales_is_not_a_moment():
    assert rules.find_moments([_month(1, date(2026, 6, 1))], UNITS) == []


def test_voucher_and_unreadable_mechanics_are_not_moments():
    promotions = [_month(1, JAN, "Voucher"), _month(2, FEB, "Mystery deal")]

    assert rules.find_moments(promotions, UNITS) == []


def test_carton_monthly_counts_as_monthly():
    moments = rules.find_moments([_month(1, JAN, promo_type="carton_monthly")], UNITS)

    assert len(moments) == 1


def test_the_same_promotion_listed_twice_is_still_one_promotion():
    promotions = [_month(1, JAN), _month(1, JAN)]

    assert len(rules.find_moments(promotions, UNITS)) == 1


# ---- measure_moments ---------------------------------------------------------------


def test_uplift_is_measured_against_the_most_common_mechanic():
    moments = [
        _moment(JAN, "pct_off_20", 100.0),
        _moment(FEB, "pct_off_20", 120.0),
        _moment(MAR, "pct_off_30", 132.0),
    ]

    measured = {m["month"]: m for m in rules.measure_moments(moments)}

    assert measured[MAR]["baseline_mechanic_key"] == "pct_off_20"
    assert measured[MAR]["baseline_units"] == 110.0
    assert measured[MAR]["uplift_pct"] == 20.0
    assert measured[JAN]["is_baseline"] is True
    assert measured[MAR]["is_baseline"] is False


def test_a_tie_for_most_common_goes_to_the_mechanic_used_most_recently():
    moments = [_moment(JAN, "pct_off_30", 120.0), _moment(FEB, "pct_off_20", 100.0)]

    measured = rules.measure_moments(moments)

    assert {m["baseline_mechanic_key"] for m in measured} == {"pct_off_20"}


def test_each_customer_and_sku_has_its_own_baseline():
    moments = [
        _moment(JAN, "pct_off_20", 100.0, customer_id=1),
        _moment(JAN, "pct_off_30", 50.0, customer_id=2),
    ]

    baselines = {m["customer_id"]: m["baseline_mechanic_key"] for m in rules.measure_moments(moments)}

    assert baselines == {1: "pct_off_20", 2: "pct_off_30"}


def test_skus_in_a_range_share_its_baseline_mechanic_but_keep_their_own_units():
    moments = [
        _moment(JAN, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(FEB, "pct_off_20", 110.0, sku="SKU-L"),
        _moment(JAN, "pct_off_30", 60.0, sku="SKU-XL"),
        _moment(FEB, "pct_off_20", 50.0, sku="SKU-XL"),
    ]
    ranges = {"SKU-L": "Pants", "SKU-XL": "Pants"}

    measured = {(m["sku"], m["month"]): m for m in rules.measure_moments(moments, ranges)}

    # 20% Off is Pants' most common mechanic (3 of 4), so SKU-XL is measured
    # against it too, from its own 20% Off month.
    assert {m["baseline_mechanic_key"] for m in measured.values()} == {"pct_off_20"}
    assert measured[("SKU-XL", JAN)]["baseline_units"] == 50.0
    assert measured[("SKU-XL", JAN)]["uplift_pct"] == 20.0
    assert measured[("SKU-L", FEB)]["baseline_units"] == 105.0


def test_a_sku_with_no_month_at_its_ranges_baseline_has_no_uplift():
    moments = [
        _moment(JAN, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(FEB, "pct_off_20", 110.0, sku="SKU-L"),
        _moment(JAN, "pct_off_30", 60.0, sku="SKU-XL"),
    ]

    xl = next(m for m in rules.measure_moments(moments, {"SKU-L": "Pants", "SKU-XL": "Pants"}) if m["sku"] == "SKU-XL")

    assert (xl["baseline_units"], xl["uplift_pct"]) == (None, None)


def test_a_baseline_that_sold_nothing_gives_no_uplift():
    moments = [_moment(JAN, "pct_off_20", 0.0), _moment(FEB, "pct_off_20", 0.0), _moment(MAR, "pct_off_30", 10.0)]

    assert {m["uplift_pct"] for m in rules.measure_moments(moments)} == {None}


def test_a_group_whose_anchor_is_a_typed_discount_has_no_baseline():
    moments = [_moment(JAN, "pct_off_20", 100.0), _moment(FEB, "pct_off_30", 120.0)]

    measured = rules.measure_moments(moments, {"SKU-L": "Pants"}, {(1, "Pants"): None})

    assert {(m["baseline_mechanic_key"], m["uplift_pct"], m["is_baseline"]) for m in measured} == {(None, None, False)}


# ---- recommend_anchors -------------------------------------------------------------


def test_the_recommended_anchor_is_the_mechanic_of_most_months_counted_once_per_month():
    moments = [
        _moment(JAN, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(JAN, "pct_off_20", 100.0, sku="SKU-XL"),
        _moment(FEB, "b2_pct_off_25", 100.0, sku="SKU-L"),
        _moment(MAR, "b2_pct_off_25", 100.0, sku="SKU-L"),
        _moment(APR, "pct_off_25", 100.0, sku="SKU-L"),
    ]

    anchors = rules.recommend_anchors(moments, {"SKU-L": "Pants", "SKU-XL": "Pants"})

    # 20% Off ran on two SKUs but in one month; Buy 2 Get 25% Off ran in two
    # months and is counted apart from 25% Off.
    pants = anchors[(1, "Pants")]
    assert (pants["mechanic_key"], pants["months"], pants["window_months"]) == ("b2_pct_off_25", 2, 4)
    assert anchors[(1, None)]["mechanic_key"] == "b2_pct_off_25"


def test_fewer_than_three_months_in_the_window_recommends_no_anchor():
    old = date(2024, 1, 1)
    moments = [_moment(old, "pct_off_20", 100.0), _moment(JAN, "pct_off_30", 100.0), _moment(FEB, "pct_off_30", 100.0)]

    pants = rules.recommend_anchors(moments, {"SKU-L": "Pants"})[(1, "Pants")]

    # The 2024 month is outside the 12 months up to February 2026.
    assert (pants["mechanic_key"], pants["window_months"]) == (None, 2)


# ---- recommend ---------------------------------------------------------------------


def test_recommended_uplift_averages_the_latest_three_moments():
    moments = [
        _moment(JAN, "pct_off_20", 100.0),
        _moment(FEB, "pct_off_20", 100.0),
        _moment(MAR, "pct_off_20", 100.0),
        _moment(date(2025, 2, 1), "pct_off_20", 100.0),
        _moment(date(2025, 4, 1), "pct_off_20", 100.0),
        _moment(date(2025, 1, 1), "pct_off_30", 150.0),
        _moment(date(2025, 3, 1), "pct_off_30", 120.0),
        _moment(APR, "pct_off_30", 125.0),
        _moment(MAY, "pct_off_30", 123.0),
    ]

    recommendations = {r["mechanic_key"]: r for r in rules.recommend(rules.measure_moments(moments))}
    thirty = recommendations["pct_off_30"]

    assert thirty["recommended_uplift_pct"] == 22.67
    assert thirty["months_used"] == ["2025-03-01", "2026-04-01", "2026-05-01"]
    assert thirty["moments"] == 4
    assert thirty["moments_by_year"] == {2025: 2, 2026: 2}
    assert thirty["enough_data"] is True


def test_the_baseline_mechanic_recommends_zero():
    moments = [_moment(JAN, "pct_off_20", 100.0), _moment(FEB, "pct_off_20", 130.0), _moment(MAR, "pct_off_30", 90.0)]

    recommendations = {r["mechanic_key"]: r for r in rules.recommend(rules.measure_moments(moments))}

    assert recommendations["pct_off_20"]["recommended_uplift_pct"] == 0.0
    assert recommendations["pct_off_20"]["is_baseline"] is True


def test_fewer_than_three_moments_gives_no_recommendation():
    moments = [_moment(JAN, "pct_off_20", 100.0), _moment(FEB, "pct_off_20", 100.0), _moment(MAR, "pct_off_30", 110.0)]

    recommendations = {r["mechanic_key"]: r for r in rules.recommend(rules.measure_moments(moments))}

    assert recommendations["pct_off_30"]["recommended_uplift_pct"] is None
    assert recommendations["pct_off_30"]["months_used"] == []
    assert recommendations["pct_off_30"]["enough_data"] is False


def test_moments_that_could_not_be_measured_do_not_count_towards_three():
    # SKU-XL has no month at its range's baseline mechanic, so its three
    # 30% Off moments have no uplift and cannot be recommended from.
    moments = [
        _moment(JAN, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(FEB, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(MAR, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(APR, "pct_off_20", 100.0, sku="SKU-L"),
        _moment(JAN, "pct_off_30", 60.0, sku="SKU-XL"),
        _moment(FEB, "pct_off_30", 60.0, sku="SKU-XL"),
        _moment(MAR, "pct_off_30", 60.0, sku="SKU-XL"),
    ]
    ranges = {"SKU-L": "Pants", "SKU-XL": "Pants"}

    xl = next(r for r in rules.recommend(rules.measure_moments(moments, ranges)) if r["sku"] == "SKU-XL")

    assert (xl["moments"], xl["recommended_uplift_pct"], xl["enough_data"]) == (3, None, False)
