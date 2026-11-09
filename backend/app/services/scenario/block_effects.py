from datetime import date


# PURE: what saved Scenario builder building blocks add to one customer's
# Current sell-out forecast, for the sell-in plan's building blocks overlay
# (inventory_service.get_sell_in_outlook). The same rules as the Scenario
# builder's Simulated line (frontend app/utils/scenarioEngine.js), so a block
# moves the forecast by the same units on both pages -- keep the two in step:
#
# - pct: that % of the Current forecast, in every month of the block.
# - units: the units spread over the block's months and SKUs in proportion to
#   their Current forecast (evenly when it is 0 everywhere).
# - Only months with a Current forecast change; a block for every SKU has
#   sku None.
# - Each block is measured against Current alone, so blocks simply add up,
#   and a decrease never takes a SKU x month below 0: that cell's decreases
#   are all scaled down by the same share (floorAtZero).


def _cells(current: dict[str, dict[date, float]], block: dict) -> list[tuple[str, date]]:
    """The SKU x months a block covers that have a Current forecast."""

    return [
        (sku, month)
        for sku, months in current.items()
        if block["sku"] is None or block["sku"] == sku
        for month in months
        if block["start_month"] <= month <= block["end_month"]
    ]


def _block_deltas(current: dict[str, dict[date, float]], block: dict) -> dict[tuple[str, date], float]:
    cells = _cells(current, block)
    if not cells:
        return {}
    value = float(block["uplift_value"])
    if block["uplift_mode"] == "pct":
        return {(sku, month): current[sku][month] * value / 100 for sku, month in cells}

    base_total = sum(current[sku][month] for sku, month in cells)
    return {
        (sku, month): value * (current[sku][month] / base_total if base_total > 0 else 1 / len(cells))
        for sku, month in cells
    }


def _floor_at_zero(base: float, deltas: list[float]) -> float:
    """One cell's total change, its decreases scaled so base + change >= 0."""

    added = sum(delta for delta in deltas if delta > 0)
    removed = sum(delta for delta in deltas if delta < 0)
    if base + added + removed >= 0:
        return added + removed
    return added + removed * (-(base + added) / removed)


def block_deltas(
    current: dict[str, dict[date, float]],
    blocks: list[dict],
) -> dict[str, dict[date, float]]:
    """
    What the blocks add to the Current forecast, as {sku: {month: units}}
    (negative for a decrease). `current` is {sku: {month: units}} for one
    customer; each block has sku (None = every SKU), uplift_mode ('pct' or
    'units'), uplift_value (signed) and start_month / end_month (first of the
    month). A cell no block reaches is left out.
    """

    per_cell: dict[tuple[str, date], list[float]] = {}
    for block in blocks:
        for cell, delta in _block_deltas(current, block).items():
            per_cell.setdefault(cell, []).append(delta)

    result: dict[str, dict[date, float]] = {}
    for (sku, month), deltas in per_cell.items():
        result.setdefault(sku, {})[month] = _floor_at_zero(current[sku][month], deltas)
    return result


def apply_blocks(
    current: dict[str, dict[date, float]],
    blocks: list[dict],
) -> dict[str, dict[date, float]]:
    """The Current forecast with the blocks' changes added (block_deltas)."""

    deltas = block_deltas(current, blocks)
    return {
        sku: {month: units + deltas.get(sku, {}).get(month, 0.0) for month, units in months.items()}
        for sku, months in current.items()
    }
