import pandas as pd
import pytest

from app.services import inventory_forecast as invf


# ---- Parameters ----------------------------------------------------------------


def test_target_doh_must_be_positive():
    with pytest.raises(ValueError, match="target_doh"):
        invf.InventoryParams(target_doh=0)


def test_horizon_months_must_be_at_least_one():
    with pytest.raises(ValueError, match="horizon_months"):
        invf.InventoryParams(horizon_months=0)


# ---- pivot_inventory_metrics ---------------------------------------------------


def _metric_row(sku, customer_id, month, metric_name, value, value_type):
    return {
        "sku": sku,
        "customer_id": customer_id,
        "period_start": f"{month}-01",
        "metric_name": metric_name,
        "metric_value": value,
        "value_type": value_type,
    }


def test_unresolved_sku_or_customer_is_dropped():
    rows = pd.DataFrame([
        _metric_row("111", 1, "2026-01", "opening_inventory", 100.0, "derived"),
        _metric_row("999", 1, "2026-01", "opening_inventory", 50.0, "derived"),  # unknown sku
        _metric_row("111", 9, "2026-01", "opening_inventory", 20.0, "derived"),  # unknown customer
    ])

    wide = invf.pivot_inventory_metrics(rows, {"111": "Widget"}, {1: "fairprice"})

    assert len(wide) == 1
    assert wide.iloc[0]["product_name"] == "Widget"
    assert wide.iloc[0]["customer_name"] == "fairprice"


def test_sell_out_base_and_building_blocks_are_summed():
    rows = pd.DataFrame([
        _metric_row("111", 1, "2026-07", "opening_inventory", 100.0, "derived"),
        _metric_row("111", 1, "2026-07", "sell_in", 50.0, "actual"),
        _metric_row("111", 1, "2026-07", "sell_out_base", 40.0, "actual"),
        _metric_row("111", 1, "2026-07", "sell_out_building_blocks", 5.0, "manual_plan"),
    ])

    wide = invf.pivot_inventory_metrics(rows, {"111": "Widget"}, {1: "fairprice"})
    row = wide.iloc[0]

    assert row["sell_out"] == 45.0
    # building_blocks is always 'manual_plan' -- known-ness follows sell_out_base only.
    assert row["sell_out_is_actual"] == True  # noqa: E712
    assert row["sell_in_is_actual"] == True  # noqa: E712


def test_missing_metric_defaults_without_raising():
    rows = pd.DataFrame([
        _metric_row("111", 1, "2026-07", "opening_inventory", 100.0, "derived"),
    ])

    wide = invf.pivot_inventory_metrics(rows, {"111": "Widget"}, {1: "fairprice"})
    row = wide.iloc[0]

    assert pd.isna(row["sell_in"])
    assert row["sell_in_is_actual"] == False  # noqa: E712
    assert row["sell_out"] == 0.0
    assert row["sell_out_is_actual"] == False  # noqa: E712


# ---- closing_inventory_for_month ------------------------------------------------


def test_both_actual_gives_actual_closing_only():
    result = invf.closing_inventory_for_month(
        opening_inventory=100.0, sell_in=50.0, sell_in_is_actual=True,
        sell_out=40.0, sell_out_is_actual=True,
    )
    assert result == {"actual_closing_inventory": 110.0, "predicted_closing_inventory": None}


def test_sell_in_not_actual_gives_predicted_closing_only():
    result = invf.closing_inventory_for_month(
        opening_inventory=100.0, sell_in=50.0, sell_in_is_actual=False,
        sell_out=40.0, sell_out_is_actual=True,
    )
    assert result == {"actual_closing_inventory": None, "predicted_closing_inventory": 110.0}


# ---- build_inventory_position ---------------------------------------------------


def _history_row(month, opening=float("nan"), sell_in=float("nan"), sell_in_actual=False,
                  sell_out=float("nan"), sell_out_actual=False):
    return {
        "month_year": pd.Period(month, "M"),
        "opening_inventory": opening,
        "sell_in": sell_in,
        "sell_in_is_actual": sell_in_actual,
        "sell_out": sell_out,
        "sell_out_is_actual": sell_out_actual,
    }


def test_actual_sell_in_and_sell_out_produce_actual_closing_only():
    history = pd.DataFrame([
        _history_row("2026-01", opening=100.0, sell_in=50.0, sell_in_actual=True,
                     sell_out=40.0, sell_out_actual=True),
        _history_row("2026-02", opening=110.0, sell_in=30.0, sell_in_actual=True,
                     sell_out=35.0, sell_out_actual=True),
    ])

    result = invf.build_inventory_position(history, {}, invf.InventoryParams(horizon_months=1))
    jan, feb = result.iloc[0], result.iloc[1]

    assert jan["actual_closing_inventory"] == 110.0
    assert pd.isna(jan["predicted_closing_inventory"])
    assert jan["inventory_position"] == 110.0

    assert feb["actual_closing_inventory"] == 105.0
    assert feb["inventory_position"] == 105.0


def test_missing_sell_in_falls_back_to_recommended_and_predicted_closing():
    history = pd.DataFrame([
        _history_row("2026-01", opening=100.0, sell_in=50.0, sell_in_actual=True,
                     sell_out=40.0, sell_out_actual=True),
        # Feb: no actual sell-in yet, opening not reported (must carry forward).
        _history_row("2026-02", sell_out=35.0, sell_out_actual=True),
    ])
    # target_doh=30, next_forecast/days_in_feb(28) = 10 -> target_inventory = 300.
    sellout_forecast = {pd.Period("2026-02", "M"): 280.0}

    result = invf.build_inventory_position(history, sellout_forecast, invf.InventoryParams(horizon_months=1))
    jan, feb = result.iloc[0], result.iloc[1]

    assert jan["inventory_position"] == 110.0  # opening 100 + sell-in 50 - sell-out 40

    assert feb["opening_inventory"] == 110.0  # carried forward from Jan's position
    assert pd.isna(feb["actual_sell_in"])
    assert feb["recommended_sell_in"] == 190.0  # target 300 - Jan's position 110
    assert pd.isna(feb["actual_closing_inventory"])
    assert feb["predicted_closing_inventory"] == 265.0  # 110 + 190 - 35
    assert feb["inventory_position"] == 265.0


def test_horizon_extends_past_last_historical_month():
    history = pd.DataFrame([
        _history_row("2026-01", opening=100.0, sell_in=50.0, sell_in_actual=True,
                     sell_out=40.0, sell_out_actual=True),
    ])

    result = invf.build_inventory_position(history, {}, invf.InventoryParams(horizon_months=3))

    assert len(result) == 4  # 1 historical + 3 horizon months
    assert result["month_year"].tolist() == [pd.Period(m, "M") for m in
                                              ["2026-01", "2026-02", "2026-03", "2026-04"]]
    # Horizon months have no actuals at all -- everything rolls forward as predicted.
    assert pd.isna(result.iloc[1]["actual_closing_inventory"])
    assert result.iloc[1]["opening_inventory"] == 110.0


def test_empty_history_returns_empty_frame():
    result = invf.build_inventory_position(pd.DataFrame(columns=invf.PIVOT_COLUMNS), {}, invf.InventoryParams())
    assert result.empty


# ---- build_all_inventory_positions ----------------------------------------------


def test_groups_are_kept_independent():
    pivoted = pd.DataFrame([
        {**_history_row("2026-01", opening=100.0, sell_in=50.0, sell_in_actual=True,
                         sell_out=40.0, sell_out_actual=True),
         "product_name": "Widget", "customer_name": "fairprice"},
        {**_history_row("2026-01", opening=10.0, sell_in=5.0, sell_in_actual=True,
                         sell_out=4.0, sell_out_actual=True),
         "product_name": "Gadget", "customer_name": "sheng_shiong"},
    ])

    result = invf.build_all_inventory_positions(pivoted, {}, invf.InventoryParams(horizon_months=1))

    widget = result[result["product_name"] == "Widget"]
    gadget = result[result["product_name"] == "Gadget"]
    assert widget.iloc[0]["inventory_position"] == 110.0
    assert gadget.iloc[0]["inventory_position"] == 11.0
