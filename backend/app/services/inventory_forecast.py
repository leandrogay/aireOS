"""
Inventory position and sell-in recommendation -- pure functions, no I/O.

Companion to pl_forecast.py: that module forecasts sell-out; this one turns
sell-out (actual or forecast) plus sell-in (actual or recommended) into a
rolling inventory position, so a sell-in recommendation can be produced every
month without waiting for every actual to land.

Two closing-inventory values are kept per month, never one overwriting the
other:
  actual_closing_inventory     opening + actual sell-in - actual sell-out,
                                only once BOTH are known.
  predicted_closing_inventory  opening + (recommended sell-in if actual
                                sell-in isn't known yet) - (forecast sell-out
                                if actual sell-out isn't known yet).

inventory_position = COALESCE(actual, predicted) is what the next month's
recommendation is built from. Comparing a month's predicted value against
the actual that eventually arrives (inventory_variance) happens once, at
MERGE time in forecast_service.py -- this module only ever computes fresh
actual/predicted values for the rows it's given.

forecast_service.py does the BigQuery/Postgres I/O and the sku/customer_id
bridging around these functions, so everything here can be tested with a
few inline DataFrame rows.
"""

from dataclasses import dataclass

import pandas as pd

GROUP_KEY = ["product_name", "customer_name"]

PIVOT_COLUMNS = [
    "product_name", "customer_name", "month_year",
    "opening_inventory", "sell_in", "sell_in_is_actual",
    "sell_out", "sell_out_is_actual",
]

POSITION_COLUMNS = [
    "month_year", "opening_inventory", "actual_sell_in", "recommended_sell_in",
    "actual_sell_out", "forecast_sell_out",
    "actual_closing_inventory", "predicted_closing_inventory", "inventory_position",
]


# ============================================================
# PARAMETERS
# ============================================================


@dataclass(frozen=True)
class InventoryParams:
    """target_doh is a business input with no source in the P&L workbook --
    this default is a placeholder until Aire sets a real target days-of-inventory.
    horizon_months is how far past the latest known month to keep recommending."""

    target_doh: float = 30.0
    horizon_months: int = 6

    def __post_init__(self) -> None:
        if self.target_doh <= 0:
            raise ValueError("target_doh must be > 0")
        if self.horizon_months < 1:
            raise ValueError("horizon_months must be at least 1")


# ============================================================
# PIVOT inventory_metrics ROWS
# ============================================================


def _col(frame: pd.DataFrame, name: str, default) -> pd.Series:
    if name in frame.columns:
        return frame[name]
    return pd.Series(default, index=frame.index)


def pivot_inventory_metrics(
    rows: pd.DataFrame,
    sku_to_product: dict[str, str],
    customer_to_name: dict[int, str],
) -> pd.DataFrame:
    """One row per (product_name, customer_name, month) from the raw EAV rows.

    sell_out_base and sell_out_building_blocks are summed into one sell_out
    figure -- the building-blocks row is a fixed manual overlay on the base,
    not a second competing number. sell_out_is_actual follows sell_out_base's
    value_type alone: building_blocks is 'manual_plan' even in known-actual
    months (see the inventory_metrics sample), so basing "known" on it would
    wrongly mark a real actual month as unknown.

    Rows whose sku/customer_id don't resolve via the given maps are dropped.
    """
    if rows.empty:
        return pd.DataFrame(columns=PIVOT_COLUMNS)

    rows = rows.copy()
    rows["product_name"] = rows["sku"].map(sku_to_product)
    rows["customer_name"] = rows["customer_id"].astype(int).map(customer_to_name)
    rows = rows.dropna(subset=["product_name", "customer_name"])
    if rows.empty:
        return pd.DataFrame(columns=PIVOT_COLUMNS)
    rows["month_year"] = pd.to_datetime(rows["period_start"]).dt.to_period("M")

    key = ["product_name", "customer_name", "month_year"]
    values = rows.pivot_table(index=key, columns="metric_name", values="metric_value", aggfunc="first")
    is_actual = (
        rows.assign(_is_actual=rows["value_type"] == "actual")
        .pivot_table(index=key, columns="metric_name", values="_is_actual", aggfunc="first")
    )

    wide = pd.DataFrame(index=values.index)
    wide["opening_inventory"] = _col(values, "opening_inventory", float("nan"))
    wide["sell_in"] = _col(values, "sell_in", float("nan"))
    wide["sell_in_is_actual"] = _col(is_actual, "sell_in", False).fillna(False)
    wide["sell_out"] = (
        _col(values, "sell_out_base", 0.0).fillna(0.0)
        + _col(values, "sell_out_building_blocks", 0.0).fillna(0.0)
    )
    wide["sell_out_is_actual"] = _col(is_actual, "sell_out_base", False).fillna(False)

    return wide.reset_index()[PIVOT_COLUMNS]


# ============================================================
# CLOSING INVENTORY
# ============================================================


def closing_inventory_for_month(
    opening_inventory: float,
    sell_in: float,
    sell_in_is_actual: bool,
    sell_out: float,
    sell_out_is_actual: bool,
) -> dict[str, float | None]:
    """Splits closing inventory into actual vs predicted for one month.

    Only when both sell-in and sell-out are actual does the month get a real
    actual_closing_inventory; otherwise it gets a predicted_closing_inventory
    built from whatever recommended/forecast values filled the gaps.
    """
    closing = opening_inventory + sell_in - sell_out
    if sell_in_is_actual and sell_out_is_actual:
        return {"actual_closing_inventory": closing, "predicted_closing_inventory": None}
    return {"actual_closing_inventory": None, "predicted_closing_inventory": closing}


# ============================================================
# ROLLING INVENTORY POSITION
# ============================================================


def build_inventory_position(
    history: pd.DataFrame,
    sellout_forecast: dict,
    params: InventoryParams,
) -> pd.DataFrame:
    """Rolls one product/customer's inventory forward month by month.

    `history` is that group's pivoted rows (see pivot_inventory_metrics).
    `sellout_forecast` maps month (pd.Period) -> forecasted units, covering
    at least every month this function has to fill a sell-out gap for --
    built by forecast_service.py from pl_forecast.forecast_sku(), so this
    module never has to know how sell-out forecasting works.

    Extends `params.horizon_months` months past the last historical month so
    a recommendation exists even where inventory_metrics has no row at all
    yet -- those months roll forward entirely from the model (opening =
    previous month's inventory_position, sell-in = previously recommended).
    """
    if history.empty:
        return pd.DataFrame(columns=POSITION_COLUMNS)

    history = history.sort_values("month_year").reset_index(drop=True)
    last_month = history["month_year"].max()
    horizon = [last_month + offset for offset in range(1, params.horizon_months + 1)]

    results = []
    position = None
    recommended = None

    for month in list(history["month_year"]) + horizon:
        row = history[history["month_year"] == month]
        known = not row.empty

        opening_raw = row["opening_inventory"].iloc[0] if known else float("nan")
        opening = opening_raw if pd.notna(opening_raw) else position
        opening = opening if pd.notna(opening) else 0.0

        sell_in_raw = row["sell_in"].iloc[0] if known else float("nan")
        sell_in_is_actual = known and bool(row["sell_in_is_actual"].iloc[0]) and pd.notna(sell_in_raw)
        recommended_fallback = recommended if pd.notna(recommended) else 0.0
        sell_in = sell_in_raw if sell_in_is_actual else recommended_fallback

        sell_out_raw = row["sell_out"].iloc[0] if known else float("nan")
        sell_out_is_actual = known and bool(row["sell_out_is_actual"].iloc[0]) and pd.notna(sell_out_raw)
        forecast_sell_out = sellout_forecast.get(month, 0.0)
        sell_out = sell_out_raw if sell_out_is_actual else forecast_sell_out

        closing = closing_inventory_for_month(
            opening_inventory=opening,
            sell_in=sell_in,
            sell_in_is_actual=sell_in_is_actual,
            sell_out=sell_out,
            sell_out_is_actual=sell_out_is_actual,
        )
        position = (
            closing["actual_closing_inventory"]
            if closing["actual_closing_inventory"] is not None
            else closing["predicted_closing_inventory"]
        )

        next_month = month + 1
        next_forecast = sellout_forecast.get(next_month, forecast_sell_out)
        target_inventory = params.target_doh * (next_forecast / next_month.end_time.day)
        recommended = max(0.0, target_inventory - position)

        results.append({
            "month_year": month,
            "opening_inventory": opening,
            "actual_sell_in": sell_in_raw if sell_in_is_actual else None,
            "recommended_sell_in": None if sell_in_is_actual else sell_in,
            "actual_sell_out": sell_out_raw if sell_out_is_actual else None,
            "forecast_sell_out": None if sell_out_is_actual else forecast_sell_out,
            "actual_closing_inventory": closing["actual_closing_inventory"],
            "predicted_closing_inventory": closing["predicted_closing_inventory"],
            "inventory_position": position,
        })

    return pd.DataFrame(results)


def build_all_inventory_positions(
    pivoted: pd.DataFrame,
    sellout_forecast_by_group: dict,
    params: InventoryParams,
) -> pd.DataFrame:
    """build_inventory_position for every product/customer group in `pivoted`.

    sellout_forecast_by_group is keyed by (product_name, customer_name) ->
    {month: units}, built by forecast_service.py.
    """
    if pivoted.empty:
        return pd.DataFrame()

    results = []
    for (product_name, customer_name), group in pivoted.groupby(GROUP_KEY):
        forecast = sellout_forecast_by_group.get((product_name, customer_name), {})
        position = build_inventory_position(group, forecast, params)
        if position.empty:
            continue
        position["product_name"] = product_name
        position["customer_name"] = customer_name
        results.append(position)

    if not results:
        return pd.DataFrame()
    return pd.concat(results, ignore_index=True)
