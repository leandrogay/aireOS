import pytest

from app.services.scenario.budget_calc import calculate_budget as calculate_with_split


def calculate_budget(rows, blocks, promotions, year):
    # These original cases have no carried effects; replacement is covered below.
    splits = [{"customer_id": row["customer_id"], "sku": row["sku"], "month_year": row["month_year"],
               "tier0": row["forecast_initial"], "baseline": row["forecast_initial"], "carried": 0} for row in rows]
    return calculate_with_split(rows, blocks, promotions, year, splits)


def initial(customer=1, sku="A", units=100, sku_range="Pants"):
    return [{"customer_id": customer, "customer_name": f"C{customer}", "sku": sku, "product_name": sku,
             "sku_range": sku_range, "month_year": f"2027-{month:02d}-01", "forecast_initial": units,
             "forecast_current": 9999} for month in range(1, 13)]


def block(**changes):
    return {"is_active": True, "customer_names": None, "sku_ranges": None, "sku": None,
            "excluded_pairs": [], "start_month": "2027-01-01", "end_month": "2027-12-01",
            "uplift_mode": "pct", "uplift_value": 10, **changes}


def promo(**changes):
    return {**block(), "reference_uplift_pct": 20, "reference_by_sku": {}, "voucher": False, **changes}


def test_budget_adds_growth_blocks_and_promotions_on_initial_alone():
    result = calculate_budget(initial(), [block()], [promo()], 2027)
    assert [row["units"] for row in result] == [130] * 12


def test_units_are_given_in_full_per_customer_with_excluded_ranges_removed():
    rows = initial() + initial(1, "B", 300, "Tape") + initial(2)
    item = block(uplift_mode="units", uplift_value=120, excluded_pairs=[{"customer_name": "C1", "sku_range": "Tape"}])
    result = calculate_budget(rows, [item], [], 2027)
    assert sum(row["units"] - row["forecast_initial"] for row in result) == 240
    assert all(row["units"] == 300 for row in result if row["sku"] == "B")


def test_promotions_keep_customer_and_product_references_and_exact_day_shares():
    item = promo(start_month="2027-11-01", end_month="2027-11-01", start_date="2027-11-01", end_date="2027-11-10",
                 voucher=True, references_by_customer={"C2": {"reference_uplift_pct": 90, "reference_by_sku": {"A": 60}, "voucher_uplift_pct": 30}})
    result = calculate_budget(initial() + initial(2), [], [item], 2027)
    november = [row for row in result if row["month_year"] == "2027-11-01"]
    assert november[0]["units"] == pytest.approx(100 + 20 / 3)
    assert november[1]["units"] == 130


def test_override_zero_and_disabled_entries_count_correctly_and_each_cell_is_floored():
    result = calculate_budget(initial(), [block(uplift_value=-100), block(uplift_mode="units", uplift_value=-120), block(is_active=False, uplift_value=50)],
                              [promo(override_uplift_pct=0)], 2027)
    assert all(row["units"] == 0 for row in result)


@pytest.mark.parametrize("rows", [[], initial()[:-1], initial() + initial()[:1]])
def test_empty_partial_or_duplicate_initial_cannot_be_locked(rows):
    with pytest.raises(ValueError):
        calculate_budget(rows, [], [], 2027)


def test_zero_baseline_splits_units_evenly_and_other_customer_and_range_entries_are_ignored():
    result = calculate_budget(initial(units=0), [block(uplift_mode="units", uplift_value=120), block(customer_names=["C2"]), block(sku_ranges=["Tape"])], [], 2027)
    assert all(row["units"] == 10 for row in result)


def carried_initial(units=110, baseline=100):
    rows = initial(units=units)
    splits = [{"customer_id": 1, "sku": "A", "month_year": row["month_year"],
               "tier0": units, "baseline": baseline, "carried": units - baseline} for row in rows]
    return rows, splits


def test_a_budget_promotion_replaces_carried_effects_instead_of_adding_to_the_whole_initial():
    rows, splits = carried_initial()
    assert all(row["units"] == 110 for row in calculate_with_split(rows, [], [], 2027, splits))
    assert all(row["units"] == 120 for row in calculate_with_split(rows, [], [promo()], 2027, splits))
    assert all(row["units"] == 131 for row in calculate_with_split(rows, [block()], [promo()], 2027, splits))


def test_zero_override_restores_an_ordinary_month_and_partial_dates_only_replace_their_share():
    rows, splits = carried_initial()
    assert all(row["units"] == 100 for row in calculate_with_split(rows, [], [promo(override_uplift_pct=0)], 2027, splits))
    item = promo(start_month="2027-11-01", end_month="2027-11-01", start_date="2027-11-01", end_date="2027-11-15")
    result = calculate_with_split(rows, [], [item], 2027, splits)
    assert result[10]["units"] == 115
    assert all(row["units"] == 110 for row in result if row["month_year"] != "2027-11-01")


def test_overlapping_promotions_remove_the_carried_effect_once_and_vouchers_stay_additive():
    rows, splits = carried_initial()
    result = calculate_with_split(rows, [], [promo(), promo(voucher=True, voucher_uplift_pct=3)], 2027, splits)
    assert all(row["units"] == 143 for row in result)


def test_excluded_pairs_keep_their_carried_effects_and_negative_carried_effects_can_be_replaced():
    rows, splits = carried_initial()
    excluded = promo(excluded_pairs=[{"customer_name": "C1", "sku_range": "Pants"}])
    assert all(row["units"] == 110 for row in calculate_with_split(rows, [], [excluded], 2027, splits))
    rows, splits = carried_initial(90, 100)
    assert all(row["units"] == 120 for row in calculate_with_split(rows, [], [promo()], 2027, splits))


def test_an_incomplete_or_different_initial_split_blocks_lock_calculation():
    rows, splits = carried_initial()
    with pytest.raises(ValueError, match="available for every cell"):
        calculate_with_split(rows, [], [], 2027, splits[:-1])
    with pytest.raises(ValueError, match="no longer matches"):
        calculate_with_split(rows, [], [], 2027, [{**split, "tier0": 999} for split in splits])
