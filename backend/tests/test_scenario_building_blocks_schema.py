from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.scenario.building_blocks import ScenarioBuildingBlockCreate


def _block(**changes):
    block = {
        "customer_names": ["fairprice"],
        "product_name": None,
        "name": "New Store Opening",
        "explanation": "3 new outlets in Punggol",
        "uplift_mode": "pct",
        "uplift_value": 10,
        "start_month": "2026-11-01",
        "end_month": "2026-12-01",
        "is_active": True,
    }
    block.update(changes)
    return block


# ---- Valid blocks ----------------------------------------------------------


def test_a_pct_block_for_all_skus_is_valid():
    block = ScenarioBuildingBlockCreate(**_block())

    assert block.product_name is None
    assert block.uplift_value == Decimal("10")
    assert block.start_month == date(2026, 11, 1)


def test_a_units_block_with_whole_units_is_valid():
    block = ScenarioBuildingBlockCreate(**_block(uplift_mode="units", uplift_value=900))

    assert block.uplift_value == Decimal("900")


def test_names_are_stripped_and_a_blank_explanation_becomes_none():
    block = ScenarioBuildingBlockCreate(**_block(name="  Gift With Purchase ", explanation="   "))

    assert block.name == "Gift With Purchase"
    assert block.explanation is None


def test_is_active_defaults_to_true():
    body = _block()
    del body["is_active"]

    assert ScenarioBuildingBlockCreate(**body).is_active is True


# ---- Rejected blocks -------------------------------------------------------


@pytest.mark.parametrize(
    "changes",
    [
        {"name": "   "},
        {"customer_names": ["x" * 256]},
        {"uplift_mode": "dollars"},
        {"uplift_value": 0},
        {"uplift_mode": "units", "uplift_value": 0},
        {"uplift_value": 50.5},
        {"uplift_value": -100.5},
        {"uplift_mode": "units", "uplift_value": 900.5},
        {"start_month": "2026-11-15"},
        {"start_month": "2026-12-01", "end_month": "2026-11-01"},
    ],
)
def test_invalid_blocks_are_rejected(changes):
    with pytest.raises(ValidationError):
        ScenarioBuildingBlockCreate(**_block(**changes))


def test_a_units_block_may_go_above_the_pct_cap():
    block = ScenarioBuildingBlockCreate(**_block(uplift_mode="units", uplift_value=5000))

    assert block.uplift_value == Decimal("5000")


# ---- Decreases ---------------------------------------------------------------


@pytest.mark.parametrize("pct", [-5, -50, -100])
def test_a_pct_decrease_down_to_minus_100_is_accepted(pct):
    block = ScenarioBuildingBlockCreate(**_block(uplift_value=pct))

    assert block.uplift_value == Decimal(pct)


def test_a_units_decrease_is_a_negative_whole_number():
    block = ScenarioBuildingBlockCreate(**_block(uplift_mode="units", uplift_value=-900))

    assert block.uplift_value == Decimal("-900")


def test_a_units_decrease_must_be_whole_units():
    with pytest.raises(ValidationError):
        ScenarioBuildingBlockCreate(**_block(uplift_mode="units", uplift_value=-900.5))


# ---- Customers ---------------------------------------------------------------


def test_customers_are_stored_in_order_once_and_none_means_every_customer():
    assert ScenarioBuildingBlockCreate(**_block(customer_names=[" NHG", "FairPrice", "NHG", ""])).customer_names == [
        "FairPrice",
        "NHG",
    ]
    assert ScenarioBuildingBlockCreate(**_block(customer_names=[])).customer_names is None
    assert ScenarioBuildingBlockCreate(**_block(customer_names=None)).customer_names is None


# ---- Growth ------------------------------------------------------------------


def _growth(**changes):
    growth = _block(kind="growth", name="Budget growth", start_month="2027-01-01",
                    end_month="2027-12-01", uplift_value=8)
    growth.update(changes)
    return growth


def test_kind_defaults_to_an_ordinary_block():
    assert ScenarioBuildingBlockCreate(**_block()).kind == "block"


def test_growth_on_every_sku_of_one_customer_over_a_whole_year_is_valid():
    block = ScenarioBuildingBlockCreate(**_growth())

    assert block.kind == "growth"
    assert block.sku_ranges is None
    assert block.product_name is None
    assert block.start_month == date(2027, 1, 1)
    assert block.end_month == date(2027, 12, 1)


def test_negative_growth_is_valid():
    assert ScenarioBuildingBlockCreate(**_growth(uplift_value=-5)).uplift_value == Decimal("-5")


@pytest.mark.parametrize(
    "changes",
    [
        {"uplift_mode": "units", "uplift_value": 900},
        {"sku_ranges": ["Ultra Tape"]},
        {"product_name": "Comfort Pants M"},
        {"start_month": "2027-02-01"},
        {"end_month": "2027-11-01"},
        {"start_month": "2027-01-01", "end_month": "2028-12-01"},
    ],
    ids=["units", "one range", "one sku", "starts after january", "ends before december", "two years"],
)
def test_growth_that_is_not_a_pct_on_every_sku_for_one_year_is_rejected(changes):
    with pytest.raises(ValidationError):
        ScenarioBuildingBlockCreate(**{**_growth(), **changes})


def test_an_unknown_kind_is_rejected():
    with pytest.raises(ValidationError):
        ScenarioBuildingBlockCreate(**_block(kind="budget"))


# ---- SKU ranges --------------------------------------------------------------


def test_a_block_for_a_sku_range_is_valid():
    block = ScenarioBuildingBlockCreate(**_block(sku_ranges=["Ultra Tape"]))

    assert block.sku_ranges == ["Ultra Tape"]
    assert block.product_name is None


def test_several_ranges_are_kept_once_each_in_order():
    block = ScenarioBuildingBlockCreate(**_block(sku_ranges=["Ultra Tape", " Comfort Pants ", "Ultra Tape"]))

    assert block.sku_ranges == ["Comfort Pants", "Ultra Tape"]


def test_an_empty_range_list_means_all_sku_ranges():
    assert ScenarioBuildingBlockCreate(**_block(sku_ranges=[])).sku_ranges is None


def test_a_block_cannot_name_both_a_range_and_one_sku():
    with pytest.raises(ValidationError):
        ScenarioBuildingBlockCreate(**_block(sku_ranges=["Ultra Tape"], product_name="Comfort Pants M"))


@pytest.mark.parametrize("customers", [None, ["fairprice", "nhg"]])
def test_growth_names_exactly_one_customer(customers):
    with pytest.raises(ValidationError, match="Growth is set for one customer"):
        ScenarioBuildingBlockCreate(**_growth(customer_names=customers))


def test_switched_off_pairs_are_stored_in_order_once():
    block = ScenarioBuildingBlockCreate(
        **_block(
            excluded_pairs=[
                {"customer_name": "nhg", "sku_range": "Ultra Tape"},
                {"customer_name": "fairprice", "sku_range": None},
                {"customer_name": "nhg", "sku_range": "Ultra Tape"},
            ]
        )
    )

    assert [(pair.customer_name, pair.sku_range) for pair in block.excluded_pairs] == [
        ("fairprice", None),
        ("nhg", "Ultra Tape"),
    ]


def test_growth_switches_nothing_off():
    with pytest.raises(ValidationError, match="nothing can be switched off"):
        ScenarioBuildingBlockCreate(
            **_growth(excluded_pairs=[{"customer_name": "fairprice", "sku_range": "Ultra Tape"}])
        )
