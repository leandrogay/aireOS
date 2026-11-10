from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.settings import promo_anchor_versions as versions


STAMP = datetime(2026, 11, 10, tzinfo=timezone.utc)
NOV_2026 = date(2026, 11, 1)
MAY_2027 = date(2027, 5, 1)
JUNE_2027 = date(2027, 6, 1)

DISCOUNTS = {"pct_off_15": Decimal("15"), "pct_off_20": Decimal("20"), "pct_off_30": Decimal("30")}


def _row(row_id, customer_id, mechanic, pct, sku_range=None, effective_from=None):
    return {
        "id": row_id,
        "customer_id": customer_id,
        "sku_range": sku_range,
        "promotion_mechanic": mechanic,
        "anchor_pct": Decimal(pct),
        "effective_from": effective_from,
        "updated_at": STAMP,
    }


# The client's case: 20% off is the anchor, 15% off is decided from May 2027.
TWENTY_THEN_FIFTEEN = [
    _row(1, 1, "20% Off", "20"),
    _row(2, 1, "15% Off", "15", effective_from=MAY_2027),
]


def _months(start, count):
    month = start
    for _ in range(count):
        yield month
        month = date(month.year + month.month // 12, month.month % 12 + 1, 1)


def _moment(month, mechanic_key, units=100.0, sku="SKU-L", **extra):
    return {
        "customer_id": 1,
        "sku": sku,
        "month": month,
        "promotion_id": month.toordinal(),
        "mechanic_key": mechanic_key,
        "mechanic_label": mechanic_key,
        "units": units,
        **extra,
    }


def _month_promo(promotion_id, month, mechanic):
    end = date.fromordinal(date(month.year + month.month // 12, month.month % 12 + 1, 1).toordinal() - 1)
    return {
        "customer_id": 1,
        "sku": "SKU-L",
        "promotion_id": promotion_id,
        "period_start": month,
        "period_end": end,
        "promo_type": "monthly",
        "promotion_mechanic": mechanic,
    }


def _measured(month, mechanic_key, uplift, version_id, baseline_key, baseline_source="version"):
    # A row as measure_by_version returns it, for choose_uplift.
    return {
        **_moment(month, mechanic_key),
        "version_id": version_id,
        "version_from": None,
        "baseline_mechanic_key": baseline_key,
        "baseline_units": 100.0,
        "baseline_source": baseline_source,
        "baseline_months": [],
        "is_baseline": mechanic_key == baseline_key,
        "uplift_pct": uplift,
    }


def _version(version_id, mechanic_key, pct, effective_from=None):
    return {
        "version_id": version_id,
        "effective_from": effective_from,
        "mechanic_key": mechanic_key,
        "mechanic_label": mechanic_key,
        "anchor_pct": Decimal(pct),
    }


FIFTEEN = _version(2, "pct_off_15", "15", MAY_2027)


# ---- version_lookup ----------------------------------------------------------------


def test_a_version_saved_for_a_later_month_applies_only_from_that_month():
    anchor_for = versions.version_lookup(TWENTY_THEN_FIFTEEN)

    assert anchor_for(1, None, date(2027, 1, 1))["mechanic_key"] == "pct_off_20"
    assert anchor_for(1, None, date(2027, 4, 1))["mechanic_key"] == "pct_off_20"
    assert anchor_for(1, None, MAY_2027)["mechanic_key"] == "pct_off_15"


def test_a_range_uses_its_own_version_else_its_customers():
    anchor_for = versions.version_lookup([_row(1, 1, "20% Off", "20"), _row(3, 1, "30% Off", "30", sku_range="Pants")])

    assert anchor_for(1, "Pants", NOV_2026)["version_id"] == 3
    assert anchor_for(1, "Tape", NOV_2026)["version_id"] == 1


def test_with_nothing_saved_there_is_no_mechanic_and_the_all_customers_discount_applies():
    anchor_for = versions.version_lookup([_row(9, None, None, "25")])

    version = anchor_for(1, "Pants", NOV_2026)

    assert (version["version_id"], version["mechanic_key"], version["anchor_pct"]) == (None, None, Decimal("25"))


# ---- find_planned_moments ----------------------------------------------------------


def test_planned_moments_are_whole_month_promotions_after_the_last_sales_month():
    promotions = [_month_promo(1, date(2026, 10, 1), "20% Off"), _month_promo(2, date(2026, 12, 1), "15% Off")]

    planned = versions.find_planned_moments(promotions, after=date(2026, 10, 1))

    assert [(m["month"], m["mechanic_key"], m["planned"]) for m in planned] == [(date(2026, 12, 1), "pct_off_15", True)]
    assert "units" not in planned[0]


# ---- project_anchors ---------------------------------------------------------------


def _clients_case():
    # 20% off every month up to Nov 2026 (sold), 15% off keyed in from Dec 2026.
    real = [_moment(month, "pct_off_20") for month in _months(date(2025, 12, 1), 12)]
    planned = [_moment(month, "pct_off_15", planned=True) for month in _months(date(2026, 12, 1), 13)]
    for moment in planned:
        del moment["units"]
    return real, planned


def test_the_clients_case_projects_15_off_from_june_2027_for_the_customer_and_its_range():
    real, planned = _clients_case()

    changes = versions.project_anchors(real, planned, {"SKU-L": "Pants"}, NOV_2026)

    assert {target: [(c["effective_from"], c["mechanic_key"]) for c in items] for target, items in changes.items()} == {
        (1, None): [(JUNE_2027, "pct_off_15")],
        (1, "Pants"): [(JUNE_2027, "pct_off_15")],
    }


def test_a_tie_keeps_the_current_anchor():
    real, planned = _clients_case()

    changes = versions.project_anchors(real, planned, {}, NOV_2026)

    # May 2027 counts 6 months at 20% off and 6 at 15%: 20% holds until
    # June, when 15% leads 7 to 5.
    assert [(c["effective_from"], c["counts"]) for c in changes[(1, None)]] == [
        (JUNE_2027, {"pct_off_20": 5, "pct_off_15": 7}),
    ]


def test_only_the_targets_asked_for_are_projected():
    real, planned = _clients_case()

    changes = versions.project_anchors(real, planned, {"SKU-L": "Pants"}, NOV_2026, targets={(1, "Pants")})

    assert list(changes) == [(1, "Pants")]


def test_without_planned_promotions_nothing_is_projected():
    real, _ = _clients_case()

    assert versions.project_anchors(real, [], {}, NOV_2026) == {}


def test_future_promotions_that_keep_what_the_sales_point_to_change_nothing():
    real, _ = _clients_case()
    planned = [_moment(month, "pct_off_20", planned=True) for month in _months(date(2026, 12, 1), 6)]

    assert versions.project_anchors(real, planned, {}, NOV_2026) == {}


# ---- measure_by_version ------------------------------------------------------------


def test_each_moment_is_measured_against_the_version_of_its_own_month():
    moments = (
        [_moment(month, "pct_off_20", 100.0) for month in _months(date(2026, 1, 1), 3)]
        + [_moment(date(2026, 4, 1), "pct_off_30", 120.0)]
        + [_moment(month, "pct_off_15", 80.0) for month in _months(MAY_2027, 3)]
        + [_moment(date(2027, 8, 1), "pct_off_30", 96.0)]
    )

    measured = {m["month"]: m for m in versions.measure_by_version(moments, {}, versions.version_lookup(TWENTY_THEN_FIFTEEN))}

    april, august = measured[date(2026, 4, 1)], measured[date(2027, 8, 1)]
    assert (april["version_id"], april["baseline_mechanic_key"], april["uplift_pct"]) == (1, "pct_off_20", 20.0)
    assert april["baseline_months"] == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert (august["version_id"], august["baseline_mechanic_key"], august["uplift_pct"]) == (2, "pct_off_15", 20.0)
    assert august["baseline_source"] == "version"


def test_too_few_months_in_the_versions_own_period_uses_every_month_at_its_mechanic():
    moments = [
        _moment(date(2026, 12, 1), "pct_off_15", 90.0),
        _moment(date(2027, 1, 1), "pct_off_15", 100.0),
        _moment(MAY_2027, "pct_off_15", 80.0),
        _moment(date(2027, 6, 1), "pct_off_30", 108.0),
    ]

    measured = versions.measure_by_version(moments, {}, versions.version_lookup(TWENTY_THEN_FIFTEEN))
    june = next(m for m in measured if m["month"] == date(2027, 6, 1))

    assert (june["baseline_source"], june["baseline_units"], june["uplift_pct"]) == ("all_time", 90.0, 20.0)


def test_a_typed_anchor_discount_has_no_baseline():
    moments = [_moment(date(2026, 1, 1), "pct_off_20"), _moment(date(2026, 2, 1), "pct_off_30", 120.0)]

    measured = versions.measure_by_version(moments, {}, versions.version_lookup([_row(1, 1, None, "20")]))

    assert all(m["uplift_pct"] is None and m["baseline_source"] is None for m in measured)


def test_with_nothing_saved_the_most_common_mechanic_is_the_baseline():
    moments = [_moment(date(2026, 1, 1), "pct_off_20"), _moment(date(2026, 2, 1), "pct_off_20"),
               _moment(date(2026, 3, 1), "pct_off_30", 110.0)]

    measured = versions.measure_by_version(moments, {}, versions.version_lookup([]))

    assert measured[-1]["baseline_mechanic_key"] == "pct_off_20"
    assert measured[-1]["uplift_pct"] == 10.0


# ---- choose_uplift -----------------------------------------------------------------


def test_three_moments_against_the_version_are_measured():
    measured = [_measured(month, "pct_off_30", uplift, 2, "pct_off_15")
                for month, uplift in zip(_months(date(2027, 6, 1), 3), (10.0, 20.0, 30.0))]

    chosen = versions.choose_uplift(measured, "pct_off_30", FIFTEEN, DISCOUNTS.get)

    assert (chosen["level"], chosen["uplift_pct"]) == (versions.MEASURED, 20.0)
    assert [m["month"] for m in chosen["moments"]] == list(_months(date(2027, 6, 1), 3))


def test_an_all_time_baseline_is_measured_with_earlier_data():
    measured = [_measured(month, "pct_off_30", 20.0, 2, "pct_off_15", baseline_source="all_time")
                for month in _months(date(2027, 6, 1), 3)]

    assert versions.choose_uplift(measured, "pct_off_30", FIFTEEN, DISCOUNTS.get)["level"] == versions.MEASURED_EARLIER


def test_the_anchor_mechanic_itself_is_zero():
    chosen = versions.choose_uplift([], "pct_off_15", FIFTEEN, DISCOUNTS.get)

    assert (chosen["level"], chosen["uplift_pct"]) == (versions.ANCHOR, 0.0)


def test_earlier_version_moments_are_converted_by_the_placeholder_relation_and_say_so():
    measured = [_measured(month, "pct_off_30", 20.0, 1, "pct_off_20") for month in _months(date(2026, 6, 1), 3)]

    chosen = versions.choose_uplift(measured, "pct_off_30", FIFTEEN, DISCOUNTS.get)

    # 20% off is +2% against a 15%-off month: (1.20 x 1.02 - 1) = +22.4%.
    assert (chosen["level"], chosen["uplift_pct"]) == (versions.MEASURED_EARLIER, 22.4)
    assert {m["converted"]["source"] for m in chosen["moments"]} == {"placeholder"}
    assert chosen["moments"][0]["converted"]["pct"] == 2.0


def test_a_measured_relation_is_used_once_the_old_anchor_has_run_three_times_under_the_new_one():
    measured = (
        [_measured(month, "pct_off_30", 20.0, 1, "pct_off_20") for month in _months(date(2026, 6, 1), 3)]
        + [_measured(month, "pct_off_20", 5.0, 2, "pct_off_15") for month in _months(MAY_2027, 3)]
    )

    chosen = versions.choose_uplift(measured, "pct_off_30", FIFTEEN, DISCOUNTS.get)

    assert chosen["uplift_pct"] == 26.0
    assert chosen["moments"][0]["converted"] == {
        "pct": 5.0, "source": "measured", "months": list(_months(MAY_2027, 3)),
    }


def test_moments_of_this_version_count_first_and_are_not_converted():
    measured = (
        [_measured(date(2026, 6, 1), "pct_off_30", 20.0, 1, "pct_off_20")]
        + [_measured(month, "pct_off_30", 10.0, 2, "pct_off_15") for month in _months(MAY_2027, 2)]
    )

    chosen = versions.choose_uplift(measured, "pct_off_30", FIFTEEN, DISCOUNTS.get)

    assert [m["converted"] is None for m in chosen["moments"]] == [False, True, True]
    assert chosen["uplift_pct"] == round((22.4 + 10.0 + 10.0) / 3, 2)


def test_too_few_moments_uses_the_placeholder_against_the_versions_anchor():
    chosen = versions.choose_uplift([], "pct_off_30", FIFTEEN, DISCOUNTS.get)

    # (30 - 15) / 5 x 2 = +6%.
    assert (chosen["level"], chosen["uplift_pct"]) == (versions.PLACEHOLDER, 6.0)
    assert chosen["placeholder"] == {"discount_pct": 30.0, "anchor_pct": 15.0}


def test_no_moments_and_no_discount_is_unavailable():
    chosen = versions.choose_uplift([], "b1g1", FIFTEEN, DISCOUNTS.get)

    assert (chosen["level"], chosen["uplift_pct"]) == (versions.UNAVAILABLE, None)
