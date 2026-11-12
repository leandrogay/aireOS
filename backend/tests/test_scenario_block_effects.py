"""
What saved building blocks add to the Current forecast for the sell-in plan's
overlay (scenario/block_effects). Same rules as the Scenario builder's
Simulated line (frontend app/utils/scenarioEngine.js), so a block moves the
forecast by the same units on both pages.
"""

from datetime import date

import pytest

from app.services.scenario.block_effects import apply_blocks, block_deltas

OCT, NOV, DEC = date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)
CURRENT = {
    "A1": {OCT: 100.0, NOV: 200.0, DEC: 300.0},
    "B2": {OCT: 100.0, NOV: 0.0},
}


def _block(**changes):
    block = {
        "block_id": 1,
        "sku": None,
        "uplift_mode": "pct",
        "uplift_value": 10.0,
        "start_month": OCT,
        "end_month": DEC,
    }
    block.update(changes)
    return block


# ---- % blocks ----


def test_a_pct_block_adds_that_share_of_current_in_each_month():
    deltas = block_deltas(CURRENT, [_block(sku="A1")])

    assert deltas == {"A1": {OCT: pytest.approx(10.0), NOV: pytest.approx(20.0), DEC: pytest.approx(30.0)}}


def test_a_range_block_reaches_only_the_skus_of_its_range():
    deltas = block_deltas(CURRENT, [_block(range_skus=["B2", "Z9"], start_month=OCT, end_month=OCT)])

    assert deltas == {"B2": {OCT: pytest.approx(10.0)}}


def test_a_range_block_spreads_units_over_its_range_only():
    deltas = block_deltas(
        CURRENT, [_block(range_skus=["A1"], uplift_mode="units", uplift_value=60.0, start_month=OCT, end_month=NOV)]
    )

    # A1 has 100 + 200 in Oct-Nov; B2 is outside the range and gets nothing.
    assert deltas == {"A1": {OCT: pytest.approx(20.0), NOV: pytest.approx(40.0)}}


def test_a_block_for_every_sku_reaches_each_of_them():
    deltas = block_deltas(CURRENT, [_block(start_month=OCT, end_month=OCT)])

    assert deltas == {"A1": {OCT: pytest.approx(10.0)}, "B2": {OCT: pytest.approx(10.0)}}


def test_months_outside_the_block_are_left_alone():
    deltas = block_deltas(CURRENT, [_block(sku="A1", start_month=NOV, end_month=NOV)])

    assert deltas == {"A1": {NOV: pytest.approx(20.0)}}


def test_a_block_with_no_current_months_adds_nothing():
    assert block_deltas(CURRENT, [_block(start_month=date(2027, 5, 1), end_month=date(2027, 6, 1))]) == {}


# ---- units blocks ----


def test_units_are_split_in_proportion_to_current():
    deltas = block_deltas(CURRENT, [_block(sku="A1", uplift_mode="units", uplift_value=600.0)])

    assert deltas["A1"] == {OCT: pytest.approx(100.0), NOV: pytest.approx(200.0), DEC: pytest.approx(300.0)}


def test_units_are_split_evenly_when_current_is_zero_everywhere():
    current = {"A1": {OCT: 0.0, NOV: 0.0}}

    deltas = block_deltas(current, [_block(uplift_mode="units", uplift_value=50.0)])

    assert deltas == {"A1": {OCT: pytest.approx(25.0), NOV: pytest.approx(25.0)}}


# ---- several blocks, decreases ----


def test_blocks_add_up_each_measured_against_current_alone():
    deltas = block_deltas(CURRENT, [_block(sku="A1"), _block(block_id=2, sku="A1", uplift_value=5.0)])

    assert deltas["A1"][OCT] == pytest.approx(15.0)


def test_a_decrease_never_takes_a_month_below_zero():
    current = {"A1": {OCT: 100.0}}
    blocks = [
        _block(uplift_mode="units", uplift_value=50.0, end_month=OCT),
        _block(block_id=2, uplift_mode="units", uplift_value=-300.0, end_month=OCT),
    ]

    assert apply_blocks(current, blocks) == {"A1": {OCT: pytest.approx(0.0)}}


def test_apply_blocks_keeps_months_no_block_reaches():
    adjusted = apply_blocks(CURRENT, [_block(sku="A1", start_month=OCT, end_month=OCT)])

    assert adjusted["A1"] == {OCT: pytest.approx(110.0), NOV: 200.0, DEC: 300.0}
    assert adjusted["B2"] == CURRENT["B2"]


def test_a_switched_off_customer_x_range_never_changes():
    current = {"A": {date(2026, 11, 1): 100.0}, "B": {date(2026, 11, 1): 100.0}}
    block = {
        "range_skus": None,
        "sku": None,
        "excluded_skus": ["B"],
        "uplift_mode": "pct",
        "uplift_value": 10,
        "start_month": date(2026, 11, 1),
        "end_month": date(2026, 11, 1),
    }

    assert block_deltas(current, [block]) == {"A": {date(2026, 11, 1): 10.0}}
