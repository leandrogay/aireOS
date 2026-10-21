from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.scenario.building_blocks import ScenarioBuildingBlockCreate


def _block(**changes):
    block = {
        "customer_name": "fairprice",
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
        {"customer_name": ""},
        {"uplift_mode": "dollars"},
        {"uplift_value": 0},
        {"uplift_value": -5},
        {"uplift_value": 50.5},
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
