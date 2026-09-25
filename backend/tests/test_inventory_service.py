from datetime import date, datetime, timezone

import pytest
from conftest import FakeConnection, FakeEngine

from app.schemas.inventory import InventoryRecordCreate, InventoryRecordUpdate
from app.services import catalog_service, forecast_units, inventory_service, sellout_units


TODAY = date(2026, 9, 24)
STAMP = datetime(2026, 9, 23, 16, 50, tzinfo=timezone.utc)

SKUS = [
    {"sku": "A1", "sku_range": "Range A", "product_name": "Pants A", "size": "L"},
    {"sku": "B2", "sku_range": "Range B", "product_name": "Pants B", "size": "XL"},
]


def _customers(*names):
    return [{"customer_id": i, "customer_name": n} for i, n in enumerate(names, start=1)]


def _metric(customer_id, sku, month, name, value):
    return {
        "customer_id": customer_id,
        "sku": sku,
        "period_start": month,
        "metric_name": name,
        "metric_value": value,
    }


def _target(customer_id=1, target=30.0, effective_from=date(2026, 1, 1), effective_to=None):
    return {
        "customer_id": customer_id,
        "effective_from": effective_from,
        "effective_to": effective_to,
        "target_doh": target,
        "source": "test",
        "created_at": STAMP,
    }


FAR_FUTURE = date(2099, 12, 31)


def _install(monkeypatch, respond):
    conn = FakeConnection(respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(inventory_service, "_get_engine", lambda: engine)
    monkeypatch.setattr(inventory_service, "_get_read_engine", lambda: engine)
    monkeypatch.setattr(catalog_service, "get_skus", lambda: SKUS)
    # Sell-out comes from the sales dashboard's data, not from inventory_metrics.
    units = getattr(respond, "sellout_units", {})
    through = getattr(respond, "sellout_through", FAR_FUTURE)
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda retailer_ids: (units, through))
    return conn


def _sales_units(metric_rows):
    """Dashboard units {sku: {month: units}} taken from a fixture's sell_out_base rows."""

    units = {}
    for row in metric_rows or []:
        if row["metric_name"] == "sell_out_base":
            units.setdefault(row["sku"], {})[row["period_start"]] = row["metric_value"]
    return units


def _router(customers=None, metrics=None, targets=None, shipped=None, **others):
    """respond() that answers by the table each statement reads."""

    def respond(sql, params):
        for fragment, rows in others.items():
            if fragment.replace("_", " ") in sql:
                return rows
        if "FROM customer_retailers" in sql:
            return [{"customer_id": 1, "retailer_id": 57}]
        if "FROM customers" in sql:
            return customers or []
        if "customer_id = :customer_id AND metric_name = 'sell_in'" in sql:
            return shipped or []
        if "FROM inventory_metrics" in sql and "DISTINCT ON" in sql:
            return metrics or []
        if "FROM customer_doh_targets" in sql:
            return targets or []
        return []

    respond.sellout_units = _sales_units(metrics)
    return respond


# ---- pickers --------------------------------------------------------------------


def test_sku_list_comes_from_the_catalog_sorted_by_range_then_name(monkeypatch):
    monkeypatch.setattr(
        catalog_service,
        "get_skus",
        lambda: [
            {"sku": "B2", "sku_range": "Range B", "product_name": "Pants B", "size": "XL"},
            {"sku": "A2", "sku_range": "Range A", "product_name": "Pants Z", "size": "L"},
            {"sku": "A1", "sku_range": "Range A", "product_name": "Pants A", "size": "L"},
        ],
    )

    skus = inventory_service.list_skus()

    assert [s["sku"] for s in skus] == ["A1", "A2", "B2"]


def test_sku_list_carries_the_catalog_names_not_just_the_codes(monkeypatch):
    _install(monkeypatch, _router())

    first = inventory_service.list_skus()[0]

    assert first == {"sku": "A1", "product_name": "Pants A", "sku_range": "Range A", "size": "L"}


# ---- effective metric values ---------------------------------------------------


def test_reads_take_one_value_per_month_and_prefer_manual_entries(monkeypatch):
    conn = _install(monkeypatch, _router(customers=_customers("fairprice")))

    inventory_service.get_overview()

    sql, params = conn.sql_containing("DISTINCT ON")[0]
    assert "(data_source = :manual_source) DESC" in sql
    assert params["manual_source"] == "manual_entry"
    assert params["customer_ids"] is None


# ---- overview ---------------------------------------------------------------------


def _two_month_metrics():
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    return [
        _metric(1, "A1", jan, "opening_inventory", 0),
        _metric(1, "A1", jan, "sell_in", 100),
        _metric(1, "A1", jan, "sell_out_base", 40),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 10),
        _metric(1, "B2", jan, "sell_in", 50),
        _metric(1, "B2", jan, "sell_out_base", 20),
    ]


def test_overview_totals_each_customers_ending_stock_by_month(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice"), _two_month_metrics()))

    overview = inventory_service.get_overview()

    assert overview["monthly"] == [
        {"customer_id": 1, "customer_name": "fairprice", "month": "2026-01-01", "ending_stock": 90.0},
        {"customer_id": 1, "customer_name": "fairprice", "month": "2026-02-01", "ending_stock": 80.0},
    ]


def test_overview_rows_carry_sku_details_and_chained_stock(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice"), _two_month_metrics()))

    rows = inventory_service.get_overview()["skus"]

    feb_a1 = next(r for r in rows if r["sku"] == "A1" and r["month"] == "2026-02-01")
    assert feb_a1["product_name"] == "Pants A"
    assert feb_a1["opening_stock"] == 60
    assert feb_a1["ending_stock"] == 50


def test_overview_sku_filter_changes_what_is_shown_not_the_figures(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice"), _two_month_metrics()))

    overview = inventory_service.get_overview(skus=["A1"])

    assert {r["sku"] for r in overview["skus"]} == {"A1"}
    assert overview["monthly"][0]["ending_stock"] == 60  # A1 only; B2's 30 is filtered out


def test_overview_date_filter_keeps_stock_chained_from_earlier_months(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice"), _two_month_metrics()))

    overview = inventory_service.get_overview(start_month=date(2026, 2, 15))

    assert {r["month"] for r in overview["skus"]} == {"2026-02-01"}
    a1 = next(r for r in overview["skus"] if r["sku"] == "A1")
    assert a1["opening_stock"] == 60  # January's ending stock, though January is not shown


def test_overview_passes_the_customer_filter_to_the_query(monkeypatch):
    conn = _install(monkeypatch, _router(_customers("fairprice")))

    inventory_service.get_overview(customer_ids=[1])

    assert conn.sql_containing("DISTINCT ON")[0][1]["customer_ids"] == [1]


def test_a_month_filled_in_after_a_skus_last_data_is_flagged_as_having_no_data(monkeypatch):
    # B2 stops after January, A1 runs to February: B2 still shows its stock for February.
    _install(monkeypatch, _router(_customers("fairprice"), _two_month_metrics()))

    rows = inventory_service.get_overview()["skus"]

    b2 = {r["month"]: r for r in rows if r["sku"] == "B2"}
    assert b2["2026-01-01"]["has_data"] is True
    assert b2["2026-02-01"]["has_data"] is False
    assert b2["2026-02-01"]["ending_stock"] == 30


def test_an_unknown_sku_code_is_shown_by_its_code(monkeypatch):
    metrics = [_metric(1, "ZZZ", date(2026, 1, 1), "sell_in", 5)]
    _install(monkeypatch, _router(_customers("fairprice"), metrics))

    row = inventory_service.get_overview()["skus"][0]

    assert row["product_name"] == "ZZZ"


# ---- customer view --------------------------------------------------------------


def _customer_view(monkeypatch, forecast=None, targets=None):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [
        _metric(1, "A1", jan, "sell_in", 400),
        _metric(1, "A1", jan, "sell_out_base", 100),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 280),
    ]
    _install(monkeypatch, _router(_customers("fairprice"), metrics, targets or [_target()]))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: forecast or {})
    return inventory_service.get_customer_view(1, today=TODAY)


def test_customer_view_computes_doh_from_forecast_when_actuals_run_out(monkeypatch):
    # Feb ending stock is 20; March forecast 310 over 31 days = 10/day -> DOH 2.
    view = _customer_view(monkeypatch, forecast={"Pants A": {date(2026, 3, 1): 310.0}})

    feb = next(r for r in view["skus"] if r["month"] == "2026-02-01")
    assert feb["ending_stock"] == 20
    assert feb["doh"] == 2.0


def test_customer_view_measures_doh_against_the_months_target(monkeypatch):
    view = _customer_view(monkeypatch, forecast={"Pants A": {date(2026, 3, 1): 310.0}})

    feb = next(r for r in view["skus"] if r["month"] == "2026-02-01")
    assert feb["target_doh"] == 30
    assert feb["doh_vs_target"] == -28
    assert feb["doh_status"] == "below_min"


def test_customer_view_uses_the_target_in_effect_at_month_end(monkeypatch):
    targets = [
        _target(target=40.0, effective_from=date(2026, 2, 1)),
        _target(target=20.0, effective_from=date(2026, 1, 1), effective_to=date(2026, 1, 31)),
    ]

    view = _customer_view(monkeypatch, targets=targets)

    by_month = {r["month"]: r["target_doh"] for r in view["trend"]}
    assert by_month == {"2026-01-01": 20.0, "2026-02-01": 40.0}


def test_customer_view_trend_has_one_row_per_month(monkeypatch):
    view = _customer_view(monkeypatch)

    assert [r["month"] for r in view["trend"]] == ["2026-01-01", "2026-02-01"]
    assert view["trend"][0]["ending_stock"] == 300


def test_customer_view_reports_the_current_threshold(monkeypatch):
    view = _customer_view(monkeypatch)

    assert view["threshold"]["target_doh"] == 30
    assert view["threshold"]["is_global_default"] is False


def test_customer_view_rejects_an_unknown_customer(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice")))

    with pytest.raises(inventory_service.CustomerNotFoundError):
        inventory_service.get_customer_view(99)


# ---- create / edit ---------------------------------------------------------------


def _record(cls=InventoryRecordCreate, **overrides):
    values = {
        "customer_ids": [1],
        "sku": "A1",
        "month": "2026-08-01",
        "sell_in": 100,
    }
    values.update(overrides)
    return cls(**values)


def _write_router(existing=(), earlier=(), sku_exists=True, latest=None):
    def respond(sql, params):
        if "FROM customers" in sql:
            return _customers("fairprice", "giant")
        if "FROM skus" in sql:
            return [(1,)] if sku_exists else []
        if "MAX(period_start)" in sql:
            return list((latest or {}).items())
        if "period_start < :month" in sql:
            return [(c,) for c in earlier]
        if "metric_name IN ('sell_in', 'sell_out_base')" in sql:
            return [(c,) for c in existing]
        return []

    return respond


def test_create_writes_manual_entry_rows_in_one_statement(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    result = inventory_service.create_records(_record(), today=TODAY)

    writes = conn.sql_containing("INSERT INTO inventory_metrics")
    assert len(writes) == 1
    params = writes[0][1]
    assert params["data_source"] == "manual_entry"
    assert params["period_start"] == date(2026, 8, 1)
    assert params["period_end"] == date(2026, 8, 31)
    assert params["as_of_date"] == TODAY
    assert params["metric_names"] == ["sell_in"]
    assert params["metric_values"] == [100.0]
    assert params["value_types"] == ["actual"]
    assert result["records_written"] == 1


def test_create_for_several_customers_writes_every_metric_for_each(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    inventory_service.create_records(_record(customer_ids=[1, 2]), today=TODAY)

    params = conn.sql_containing("INSERT INTO inventory_metrics")[0][1]
    assert params["customer_ids"] == [1, 2]


def test_create_refuses_a_month_that_already_has_data_and_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _write_router(existing=[1]))

    with pytest.raises(inventory_service.InventoryConflictError, match="fairprice"):
        inventory_service.create_records(_record(), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_create_refuses_an_unknown_customer(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    with pytest.raises(inventory_service.CustomerNotFoundError):
        inventory_service.create_records(_record(customer_ids=[9]), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_create_refuses_an_unknown_sku(monkeypatch):
    conn = _install(monkeypatch, _write_router(sku_exists=False))

    with pytest.raises(inventory_service.SkuNotFoundError):
        inventory_service.create_records(_record(), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_opening_inventory_is_refused_when_the_sku_has_earlier_months(monkeypatch):
    conn = _install(monkeypatch, _write_router(earlier=[1]))

    with pytest.raises(ValueError, match="first month"):
        inventory_service.create_records(_record(opening_inventory=50), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_opening_inventory_is_written_for_a_skus_first_month(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    inventory_service.create_records(_record(opening_inventory=50), today=TODAY)

    params = conn.sql_containing("INSERT INTO inventory_metrics")[0][1]
    assert "opening_inventory" in params["metric_names"]


def test_edit_writes_manual_entry_rows_for_a_month_that_has_data(monkeypatch):
    conn = _install(monkeypatch, _write_router(existing=[1]))

    inventory_service.update_records(_record(InventoryRecordUpdate, sell_in=120), today=TODAY)

    params = conn.sql_containing("INSERT INTO inventory_metrics")[0][1]
    assert params["metric_values"][0] == 120.0


def test_edit_refuses_a_month_with_no_data_and_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _write_router(existing=[]))

    with pytest.raises(inventory_service.InventoryNotFoundError, match="fairprice"):
        inventory_service.update_records(_record(InventoryRecordUpdate), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_edit_of_several_customers_fails_if_any_has_no_data(monkeypatch):
    conn = _install(monkeypatch, _write_router(existing=[1]))

    with pytest.raises(inventory_service.InventoryNotFoundError, match="giant"):
        inventory_service.update_records(
            _record(InventoryRecordUpdate, customer_ids=[1, 2]), today=TODAY
        )

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


# ---- DOH thresholds: read ---------------------------------------------------------


def test_a_customer_with_a_target_shows_it_with_a_derived_band(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice"), targets=[_target(target=40.0)]))

    view = inventory_service.get_doh_thresholds(today=TODAY)[0]

    assert (view["min_doh"], view["target_doh"], view["max_doh"]) == (35, 40, 45)
    assert view["is_global_default"] is False
    assert view["last_updated"] == STAMP.isoformat()


def test_a_customer_without_a_target_gets_the_global_default(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice", "giant"), targets=[_target(customer_id=1)]))

    views = inventory_service.get_doh_thresholds(today=TODAY)

    giant = next(v for v in views if v["customer_name"] == "giant")
    assert (giant["min_doh"], giant["target_doh"], giant["max_doh"]) == (25, 30, 35)
    assert giant["is_global_default"] is True
    assert giant["last_updated"] is None


def test_a_closed_target_no_longer_applies(monkeypatch):
    closed = _target(effective_to=date(2026, 9, 1))
    _install(monkeypatch, _router(_customers("fairprice"), targets=[closed]))

    assert inventory_service.get_doh_thresholds(today=TODAY)[0]["is_global_default"] is True


# ---- DOH thresholds: write ---------------------------------------------------------


def _threshold_router(targets):
    def respond(sql, params):
        if "FROM customers" in sql:
            return _customers("fairprice", "giant")
        if "FROM customer_doh_targets" in sql:
            wanted = (params or {}).get("customer_id")
            return [t for t in targets if wanted is None or t["customer_id"] == wanted]
        return []

    return respond


def test_a_new_day_closes_the_open_target_then_inserts_the_new_one(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([_target()]))

    inventory_service.set_doh_thresholds([1], 35, today=TODAY)

    closes = conn.sql_containing("SET effective_to = :effective_to")
    assert closes[0][1]["effective_to"] == date(2026, 9, 23)
    inserts = conn.sql_containing("INSERT INTO customer_doh_targets")
    assert inserts[0][1]["effective_from"] == TODAY
    assert inserts[0][1]["target_doh"] == 35.0


def test_a_second_change_on_the_same_day_updates_the_open_row_in_place(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([_target(effective_from=TODAY)]))

    inventory_service.set_doh_thresholds([1], 35, today=TODAY)

    assert conn.sql_containing("INSERT INTO customer_doh_targets") == []
    updates = conn.sql_containing("SET target_doh = :target_doh")
    assert updates[0][1]["target_doh"] == 35.0


def test_setting_the_same_target_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([_target(target=30.0)]))

    inventory_service.set_doh_thresholds([1], 30, today=TODAY)

    assert conn.sql_containing("INSERT INTO customer_doh_targets") == []
    assert conn.sql_containing("UPDATE customer_doh_targets") == []


def test_a_customer_with_no_target_just_gets_a_new_row(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([]))

    inventory_service.set_doh_thresholds([2], 28, today=TODAY)

    assert conn.sql_containing("UPDATE customer_doh_targets") == []
    assert conn.sql_containing("INSERT INTO customer_doh_targets")[0][1]["customer_id"] == 2


def test_several_customers_are_all_updated(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([]))

    inventory_service.set_doh_thresholds([1, 2], 28, today=TODAY)

    ids = [p["customer_id"] for _, p in conn.sql_containing("INSERT INTO customer_doh_targets")]
    assert ids == [1, 2]


def test_setting_a_target_for_an_unknown_customer_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([]))

    with pytest.raises(inventory_service.CustomerNotFoundError):
        inventory_service.set_doh_thresholds([1, 9], 28, today=TODAY)

    assert conn.sql_containing("INSERT INTO customer_doh_targets") == []


# ---- DOH thresholds: reset ---------------------------------------------------------


def test_reset_closes_an_older_target_so_it_stays_as_history(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([_target()]))

    inventory_service.reset_doh_threshold(1, today=TODAY)

    assert conn.sql_containing("SET effective_to = :effective_to")[0][1]["effective_to"] == date(2026, 9, 23)
    assert conn.sql_containing("DELETE FROM customer_doh_targets") == []


def test_reset_deletes_a_target_that_was_opened_today(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([_target(effective_from=TODAY)]))

    inventory_service.reset_doh_threshold(1, today=TODAY)

    assert len(conn.sql_containing("DELETE FROM customer_doh_targets")) == 1


def test_reset_of_a_customer_already_on_the_default_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _threshold_router([]))

    inventory_service.reset_doh_threshold(2, today=TODAY)

    assert conn.sql_containing("UPDATE customer_doh_targets") == []
    assert conn.sql_containing("DELETE FROM customer_doh_targets") == []


# ---- DOH thresholds: history --------------------------------------------------------


def test_history_pairs_each_target_with_the_value_it_replaced(monkeypatch):
    targets = [
        _target(target=35.0, effective_from=date(2026, 6, 1)),
        _target(target=30.0, effective_from=date(2026, 1, 1), effective_to=date(2026, 5, 31)),
    ]
    _install(monkeypatch, _threshold_router(targets))

    history = inventory_service.get_doh_history(1)

    assert history[0]["target_doh"] == 35
    assert history[0]["previous_target_doh"] == 30
    assert history[0]["previous_effective_from"] == "2026-01-01"
    assert history[1]["previous_target_doh"] is None
    assert history[1]["effective_to"] == "2026-05-31"


# ---- sell-in plan ------------------------------------------------------------------


def _plan_view(monkeypatch, forecast, targets=None, months=2):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [
        _metric(1, "A1", jan, "sell_in", 400),
        _metric(1, "A1", jan, "sell_out_base", 100),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 280),
        _metric(1, "B2", jan, "sell_in", 50),
        _metric(1, "B2", jan, "sell_out_base", 20),
    ]
    _install(monkeypatch, _router(_customers("fairprice"), metrics, targets or [_target(target=10.0)]))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: forecast)
    return inventory_service.get_sell_in_plan(1, months=months, today=TODAY)


# March 310 (31d) and April 300 (30d): 610 units over 61 days = 10 a day.
_PLAN_FORECAST = {"Pants A": {date(2026, 3, 1): 310.0, date(2026, 4, 1): 300.0}}


def test_the_plan_starts_the_month_after_the_latest_actual_data(monkeypatch):
    plan = _plan_view(monkeypatch, _PLAN_FORECAST)

    assert plan["actuals_through"] == "2026-02-01"
    assert [r["month"] for r in plan["rows"]] == ["2026-03-01", "2026-04-01"]


def test_the_plan_opens_at_the_skus_last_actual_ending_stock(monkeypatch):
    # A1: 400 - 100 = 300 at end of January, +0 - 280 = 20 at end of February.
    plan = _plan_view(monkeypatch, _PLAN_FORECAST)

    assert plan["rows"][0]["opening_stock"] == 20


def test_the_recommendation_tops_stock_up_to_the_target_days_from_the_start_of_the_month(monkeypatch):
    # March 310 + April 300 = 610 units over 61 days = 10 a day; 10 days = 100 needed; 20 in hand -> sell in 80.
    plan = _plan_view(monkeypatch, _PLAN_FORECAST)

    march = plan["rows"][0]
    assert march["stock_needed"] == 100
    assert march["recommended_sell_in"] == 80
    assert march["stock_after_sell_in"] == 100
    assert march["target_doh"] == 10


def test_a_sku_with_no_forecast_is_listed_rather_than_planned(monkeypatch):
    plan = _plan_view(monkeypatch, _PLAN_FORECAST)

    assert {r["sku"] for r in plan["rows"]} == {"A1"}
    assert [s["sku"] for s in plan["skus_without_forecast"]] == ["B2"]


def test_totals_are_summed_per_month_and_per_sku(monkeypatch):
    plan = _plan_view(monkeypatch, _PLAN_FORECAST)

    assert [t["month"] for t in plan["monthly_totals"]] == ["2026-03-01", "2026-04-01"]
    assert plan["monthly_totals"][0]["recommended_sell_in"] == 80
    assert plan["sku_totals"][0]["sku"] == "A1"
    assert plan["sku_totals"][0]["recommended_sell_in"] == sum(r["recommended_sell_in"] for r in plan["rows"])


def test_the_plan_is_limited_to_the_months_asked_for(monkeypatch):
    plan = _plan_view(monkeypatch, _PLAN_FORECAST, months=1)

    assert [r["month"] for r in plan["rows"]] == ["2026-03-01"]


def test_a_customer_with_no_inventory_gets_an_empty_plan(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice")))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: _PLAN_FORECAST)

    plan = inventory_service.get_sell_in_plan(1, today=TODAY)

    assert plan["rows"] == []
    assert plan["actuals_through"] is None


def test_the_plan_rejects_an_unknown_customer(monkeypatch):
    _install(monkeypatch, _router(_customers("fairprice")))

    with pytest.raises(inventory_service.CustomerNotFoundError):
        inventory_service.get_sell_in_plan(99, today=TODAY)


# ---- actuals only for finished months ----------------------------------------------


def test_actuals_are_refused_for_the_current_month(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    with pytest.raises(ValueError, match="has not ended"):
        inventory_service.create_records(_record(month="2026-09-01"), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_actuals_are_refused_for_a_future_month(monkeypatch):
    conn = _install(monkeypatch, _write_router(existing=[1]))

    with pytest.raises(ValueError, match="has not ended"):
        inventory_service.update_records(_record(InventoryRecordUpdate, month="2026-11-01"), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_actuals_are_accepted_once_the_month_has_ended(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    inventory_service.create_records(_record(month="2026-08-01"), today=TODAY)

    assert len(conn.sql_containing("INSERT INTO inventory_metrics")) == 1


def test_a_month_ends_on_its_last_day(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    # September 2026 ends on the 30th, so on the 30th it has not finished; on 1 October it has.
    with pytest.raises(ValueError):
        inventory_service.create_records(_record(month="2026-09-01"), today=date(2026, 9, 30))
    inventory_service.create_records(_record(month="2026-09-01"), today=date(2026, 10, 1))

    assert len(conn.sql_containing("INSERT INTO inventory_metrics")) == 1


# ---- shipped so far: reads never mix it into actuals -------------------------------


def test_shipped_so_far_rows_are_left_out_of_every_actuals_read():
    for sql in (
        inventory_service._EFFECTIVE_METRICS_SQL,
        inventory_service._CUSTOMERS_WITH_MONTH_SQL,
        inventory_service._CUSTOMERS_WITH_EARLIER_MONTH_SQL,
        inventory_service._LATEST_ACTUAL_MONTH_SQL,
    ):
        assert "NOT (metric_name = 'sell_in' AND value_type = 'manual_plan')" in sql


# ---- shipped so far: writing -------------------------------------------------------


def _shipped(**overrides):
    from app.schemas.inventory import ShippedSoFarUpdate

    values = {"customer_ids": [1], "sku": "A1", "month": "2026-10-01", "shipped_so_far": 500}
    values.update(overrides)
    return ShippedSoFarUpdate(**values)


def test_shipped_so_far_is_saved_as_a_manual_plan_sell_in_row(monkeypatch):
    conn = _install(monkeypatch, _write_router(latest={1: date(2026, 7, 1)}))

    result = inventory_service.set_shipped_so_far(_shipped(), today=TODAY)

    params = conn.sql_containing("INSERT INTO inventory_metrics")[0][1]
    assert params["metric_names"] == ["sell_in"]
    assert params["value_types"] == ["manual_plan"]
    assert params["metric_values"] == [500.0]
    assert params["data_source"] == "manual_entry"
    assert params["period_start"] == date(2026, 10, 1)
    assert result["shipped_so_far"] == 500


def test_shipped_so_far_can_be_saved_for_several_customers(monkeypatch):
    conn = _install(monkeypatch, _write_router(latest={1: date(2026, 7, 1)}))

    inventory_service.set_shipped_so_far(_shipped(customer_ids=[1, 2]), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics")[0][1]["customer_ids"] == [1, 2]


def test_shipped_so_far_is_refused_for_a_month_that_already_has_actuals(monkeypatch):
    conn = _install(monkeypatch, _write_router(latest={1: date(2026, 7, 1)}))

    with pytest.raises(ValueError, match="already has actual data"):
        inventory_service.set_shipped_so_far(_shipped(month="2026-07-01"), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_shipped_so_far_is_allowed_for_a_customer_with_no_actuals_yet(monkeypatch):
    conn = _install(monkeypatch, _write_router(latest={}))

    inventory_service.set_shipped_so_far(_shipped(), today=TODAY)

    assert len(conn.sql_containing("INSERT INTO inventory_metrics")) == 1


def test_shipped_so_far_rejects_an_unknown_customer_and_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _write_router())

    with pytest.raises(inventory_service.CustomerNotFoundError):
        inventory_service.set_shipped_so_far(_shipped(customer_ids=[9]), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_shipped_so_far_rejects_an_unknown_sku_and_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, _write_router(sku_exists=False))

    with pytest.raises(inventory_service.SkuNotFoundError):
        inventory_service.set_shipped_so_far(_shipped(), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


# ---- shipped so far: in the plan ---------------------------------------------------


def test_the_plan_takes_shipped_so_far_off_what_is_still_to_send(monkeypatch):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [
        _metric(1, "A1", jan, "sell_in", 400),
        _metric(1, "A1", jan, "sell_out_base", 100),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 280),
    ]
    shipped = [{"sku": "A1", "period_start": date(2026, 3, 1), "metric_value": 50.0}]
    _install(monkeypatch, _router(_customers("fairprice"), metrics, [_target(target=10.0)], shipped))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: _PLAN_FORECAST)

    plan = inventory_service.get_sell_in_plan(1, months=2, today=TODAY)

    march = plan["rows"][0]
    assert march["shipped_so_far"] == 50
    assert march["recommended_sell_in"] == 30  # 80 without the shipment
    assert march["stock_after_sell_in"] == 100
    assert plan["monthly_totals"][0]["shipped_so_far"] == 50


# ---- sell-in plan: each SKU plans from its own last actual month ---------------------


def _two_sku_plan(monkeypatch, months=2):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [
        _metric(1, "A1", jan, "sell_in", 400),
        _metric(1, "A1", jan, "sell_out_base", 100),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 280),
        _metric(1, "B2", jan, "sell_in", 50),  # B2 has no February yet
        _metric(1, "B2", jan, "sell_out_base", 20),
    ]
    forecast = {
        "Pants A": {date(2026, 3, 1): 310.0, date(2026, 4, 1): 300.0, date(2026, 5, 1): 310.0},
        "Pants B": {
            date(2026, 2, 1): 280.0,
            date(2026, 3, 1): 310.0,
            date(2026, 4, 1): 300.0,
            date(2026, 5, 1): 310.0,
        },
    }
    _install(monkeypatch, _router(_customers("fairprice"), metrics, [_target(target=10.0)]))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: forecast)
    return inventory_service.get_sell_in_plan(1, months=months, today=TODAY)


def test_each_sku_plans_from_the_month_after_its_own_last_actual(monkeypatch):
    plan = _two_sku_plan(monkeypatch)

    first_month = {}
    for row in plan["rows"]:
        first_month.setdefault(row["sku"], row["month"])
    assert first_month == {"A1": "2026-03-01", "B2": "2026-02-01"}


def test_a_sku_without_a_recent_month_opens_at_its_own_last_ending_stock(monkeypatch):
    plan = _two_sku_plan(monkeypatch)

    b2_first = next(r for r in plan["rows"] if r["sku"] == "B2")
    assert b2_first["opening_stock"] == 30  # 50 in - 20 out in January, not carried through February


def test_every_sku_gets_the_months_asked_for_from_its_own_start(monkeypatch):
    plan = _two_sku_plan(monkeypatch, months=2)

    months_by_sku = {}
    for row in plan["rows"]:
        months_by_sku.setdefault(row["sku"], []).append(row["month"])
    assert months_by_sku == {
        "A1": ["2026-03-01", "2026-04-01"],
        "B2": ["2026-02-01", "2026-03-01"],
    }


def test_the_plan_reports_each_skus_last_actual_month(monkeypatch):
    plan = _two_sku_plan(monkeypatch)

    assert plan["actuals_through_by_sku"] == {"A1": "2026-02-01", "B2": "2026-01-01"}
    assert plan["actuals_through"] == "2026-02-01"


def test_a_month_total_only_adds_the_skus_being_planned_that_month(monkeypatch):
    plan = _two_sku_plan(monkeypatch)

    february = next(t for t in plan["monthly_totals"] if t["month"] == "2026-02-01")
    b2_february = next(r for r in plan["rows"] if r["sku"] == "B2" and r["month"] == "2026-02-01")
    assert february["recommended_sell_in"] == b2_february["recommended_sell_in"]


def test_the_shipped_so_far_check_looks_only_at_that_skus_actuals(monkeypatch):
    conn = _install(monkeypatch, _write_router(latest={1: date(2026, 7, 1)}))

    inventory_service.set_shipped_so_far(_shipped(sku="A1"), today=TODAY)

    sql, params = conn.sql_containing("MAX(period_start)")[0]
    assert "sku = :sku" in sql
    assert params["sku"] == "A1"


# ---- sell-out comes from the sales dashboard's data --------------------------------


def test_sell_out_is_taken_from_the_dashboard_data_not_from_inventory_metrics(monkeypatch):
    jan = date(2026, 1, 1)
    metrics = [_metric(1, "A1", jan, "sell_in", 400), _metric(1, "A1", jan, "sell_out_base", 999)]
    respond = _router(_customers("fairprice"), metrics)
    _install(monkeypatch, respond)
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({"A1": {jan: 100.0}}, FAR_FUTURE))

    row = inventory_service.get_overview()["skus"][0]

    assert row["sell_out"] == 100  # the workbook's 999 is ignored
    assert row["ending_stock"] == 300


def test_a_sku_with_no_sales_that_month_has_zero_sell_out(monkeypatch):
    jan = date(2026, 1, 1)
    _install(monkeypatch, _router(_customers("fairprice"), [_metric(1, "A1", jan, "sell_in", 50)]))
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({}, FAR_FUTURE))

    row = inventory_service.get_overview()["skus"][0]

    assert row["sell_out"] == 0
    assert row["ending_stock"] == 50


def test_sales_are_looked_up_for_the_customers_retailers(monkeypatch):
    seen = []
    _install(monkeypatch, _router(_customers("fairprice"), [_metric(1, "A1", date(2026, 1, 1), "sell_in", 5)]))
    monkeypatch.setattr(
        sellout_units, "get_monthly_sellout", lambda ids: seen.append(ids) or ({}, FAR_FUTURE)
    )

    inventory_service.get_overview()

    assert seen == [[57]]


def test_a_month_the_dashboard_data_does_not_fully_cover_is_not_an_actual(monkeypatch):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [_metric(1, "A1", jan, "sell_in", 50), _metric(1, "A1", feb, "sell_in", 50)]
    _install(monkeypatch, _router(_customers("fairprice"), metrics))
    monkeypatch.setattr(
        sellout_units, "get_monthly_sellout", lambda ids: ({"A1": {jan: 10.0}}, date(2026, 2, 19))
    )

    months = {r["month"] for r in inventory_service.get_overview()["skus"]}

    assert months == {"2026-01-01"}  # data only reaches 19 February, so February is not complete


def test_a_month_is_complete_on_the_last_day_the_data_covers(monkeypatch):
    feb = date(2026, 2, 1)
    _install(monkeypatch, _router(_customers("fairprice"), [_metric(1, "A1", feb, "sell_in", 50)]))
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({}, date(2026, 2, 28)))

    assert len(inventory_service.get_overview()["skus"]) == 1


def test_actuals_are_refused_for_a_month_the_dashboard_data_does_not_cover_yet(monkeypatch):
    conn = _install(monkeypatch, _write_router())
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({}, date(2026, 8, 19)))

    with pytest.raises(ValueError, match="only loaded through 19 Aug 2026"):
        inventory_service.create_records(_record(month="2026-08-01"), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_actuals_are_refused_when_there_is_no_sales_data_at_all(monkeypatch):
    conn = _install(monkeypatch, _write_router())
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({}, None))

    with pytest.raises(ValueError, match="not loaded yet"):
        inventory_service.create_records(_record(month="2026-08-01"), today=TODAY)

    assert conn.sql_containing("INSERT INTO inventory_metrics") == []


def test_actuals_are_accepted_when_the_dashboard_data_covers_the_month(monkeypatch):
    conn = _install(monkeypatch, _write_router())
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", lambda ids: ({}, date(2026, 8, 31)))

    inventory_service.create_records(_record(month="2026-08-01"), today=TODAY)

    assert len(conn.sql_containing("INSERT INTO inventory_metrics")) == 1


# ---- at risk ------------------------------------------------------------------------


# A1 ends February on 20 units, B2 on 1,030; both sell about 10 a day going forward, so
# A1 has 2.0 days of cover (low) and B2 103 days (overstock). C3 has no forecast, so no DOH.
_RISK_FORECAST = {
    "Pants A": {date(2026, 3, 1): 310.0, date(2026, 4, 1): 300.0, date(2026, 5, 1): 310.0},
    "Pants B": {date(2026, 3, 1): 310.0, date(2026, 4, 1): 300.0, date(2026, 5, 1): 310.0},
}


def _risk_view(monkeypatch, target=30.0, **kwargs):
    jan, feb = date(2026, 1, 1), date(2026, 2, 1)
    metrics = [
        _metric(1, "A1", jan, "sell_in", 400),
        _metric(1, "A1", jan, "sell_out_base", 100),
        _metric(1, "A1", feb, "sell_in", 0),
        _metric(1, "A1", feb, "sell_out_base", 280),
        _metric(1, "B2", jan, "sell_in", 50),
        _metric(1, "B2", jan, "sell_out_base", 20),
        _metric(1, "B2", feb, "sell_in", 1000),
        _metric(1, "C3", jan, "sell_in", 5),
        _metric(1, "C3", feb, "sell_in", 5),
    ]
    _install(monkeypatch, _router(_customers("fairprice"), metrics, [_target(target=target)]))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: _RISK_FORECAST)
    return inventory_service.get_at_risk(**kwargs)


def test_skus_outside_their_band_are_on_the_at_risk_list(monkeypatch):
    risk = _risk_view(monkeypatch)

    by_sku = {item["sku"]: item for item in risk["items"]}
    assert by_sku["A1"]["doh_status"] == "below_min"
    assert by_sku["B2"]["doh_status"] == "above_max"


def test_the_list_carries_stock_doh_and_the_band(monkeypatch):
    item = next(i for i in _risk_view(monkeypatch)["items"] if i["sku"] == "A1")

    assert item["customer_name"] == "fairprice"
    assert item["product_name"] == "Pants A"
    assert item["month"] == "2026-02-01"
    assert item["ending_stock"] == 20
    assert (item["doh"], item["target_doh"], item["min_doh"], item["max_doh"]) == (2.0, 30, 25, 35)


def test_days_outside_the_band_is_measured_from_the_nearest_edge(monkeypatch):
    by_sku = {i["sku"]: i for i in _risk_view(monkeypatch)["items"]}

    assert by_sku["A1"]["days_outside_band"] == 23  # 2.0 against a min of 25
    assert by_sku["B2"]["days_outside_band"] == 68  # 103.0 against a max of 35


def test_the_most_severe_sku_is_listed_first(monkeypatch):
    assert [i["sku"] for i in _risk_view(monkeypatch)["items"]] == ["B2", "A1"]


def test_a_sku_with_no_doh_is_not_flagged(monkeypatch):
    assert "C3" not in {i["sku"] for i in _risk_view(monkeypatch)["items"]}


def test_a_sku_back_inside_its_band_drops_off_the_list(monkeypatch):
    # With a target of 2 days the band is -3 to 7, so A1's 2.0 days is fine.
    risk = _risk_view(monkeypatch, target=2.0)

    assert "A1" not in {i["sku"] for i in risk["items"]}


def test_the_list_can_be_narrowed_to_one_kind_of_risk(monkeypatch):
    risk = _risk_view(monkeypatch, risk="below_min")

    assert [i["sku"] for i in risk["items"]] == ["A1"]


def test_the_counts_cover_both_kinds_even_when_the_list_is_narrowed(monkeypatch):
    risk = _risk_view(monkeypatch, risk="below_min")

    assert risk["counts"] == {"below_min": 1, "above_max": 1}


def test_the_list_says_which_month_it_is_judged_on(monkeypatch):
    assert _risk_view(monkeypatch)["as_of"] == "2026-02-01"


def test_an_unknown_risk_kind_is_refused(monkeypatch):
    with pytest.raises(ValueError, match="risk must be one of"):
        _risk_view(monkeypatch, risk="fine")


def test_at_risk_rejects_an_unknown_customer(monkeypatch):
    with pytest.raises(inventory_service.CustomerNotFoundError):
        _risk_view(monkeypatch, customer_ids=[99])


def test_at_risk_only_reads_the_chosen_customers(monkeypatch):
    conn = _install(monkeypatch, _router(_customers("fairprice", "giant")))
    monkeypatch.setattr(forecast_units, "get_forecast_units", lambda customer_id: {})

    inventory_service.get_at_risk(customer_ids=[2])

    assert conn.sql_containing("DISTINCT ON")[0][1]["customer_ids"] == [2]


def test_the_overview_can_be_limited_to_sku_that_are_at_risk(monkeypatch):
    _risk_view(monkeypatch)  # installs the fixtures

    overview = inventory_service.get_overview(at_risk_only=True)

    assert {r["sku"] for r in overview["skus"]} == {"A1", "B2"}  # C3 has no DOH, so it is left out


def test_the_overview_shows_every_sku_when_the_filter_is_off(monkeypatch):
    _risk_view(monkeypatch)

    overview = inventory_service.get_overview()

    assert {r["sku"] for r in overview["skus"]} == {"A1", "B2", "C3"}
