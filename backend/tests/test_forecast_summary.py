import datetime

import pytest

from app.services import forecast_summary


def _row(month, customer="fairprice", product="Aire Ultra Tape L", sku="13271338", current=52.0, **extra):
    return {
        "customer_id": extra.get("customer_id", 1),
        "customer_name": customer,
        "product_name": product,
        "sku": sku,
        "month_year": month,
        "forecast_current": current,
        "current_low_80": extra.get("low", 30.4),
        "current_high_80": extra.get("high", 79.6),
        "current_confidence_band": extra.get("band", "low"),
        "current_backtest_smape": extra.get("smape", 58.4),
        "current_source_model": extra.get("model", "tier0_legacy"),
        "current_generated_at": extra.get("generated_at", "2026-10-04T17:14:40Z"),
    }


def _actual(month, cartons, customer="fairprice", product="Aire Ultra Tape L", revenue=None):
    return {
        "customer_name": customer, "product_name": product, "month_year": month,
        "quantity_cartons": cartons, "revenue": revenue,
    }


_TODAY = datetime.date(2026, 10, 24)
_FRESHNESS = {"current_generated_at": "2026-10-04T17:14:40Z", "latest_sales_loaded_at": "2026-10-06T05:05:11Z"}


def _window(start, end):
    return datetime.date.fromisoformat(start), datetime.date.fromisoformat(end)


# ---- Display rules match the Forecast page ----------------------------------

def test_whole_cartons_rounds_halves_up_like_javascript():
    assert forecast_summary.whole_cartons(52.5) == 53
    assert forecast_summary.whole_cartons(51.5) == 52
    assert forecast_summary.whole_cartons(-2.5) == -2
    assert forecast_summary.whole_cartons(None) is None


def test_confidence_uses_earliest_forecast_month_and_page_wording():
    rows = [
        _row("2026-10-01", band="high", model="tier1_arima"),
        _row("2026-09-01", band="low", model="tier0_legacy", smape=58.4),
    ]

    confidence = forecast_summary.forecast_confidence(rows)

    assert confidence["label"] == "Low"
    assert confidence["reason"] == "limited sales history, check before using"
    assert "off by about 58%" in confidence["detail"]


def test_unknown_band_is_not_yet_scored():
    confidence = forecast_summary.forecast_confidence([_row("2026-09-01", band=None, smape=None)])

    assert confidence["label"] == "Not yet scored"
    assert confidence["detail"].startswith("This forecast has not been tested")


def test_sgt_timestamp_matches_page_format():
    assert forecast_summary.format_sgt_timestamp("2026-10-04T17:14:40Z") == "5 Oct 2026, 1:14 am"
    assert forecast_summary.format_sgt_timestamp(None) is None


# ---- Scope ------------------------------------------------------------------

def test_scope_resolves_partial_name_sku_code_and_spaced_customer():
    rows = [_row("2026-09-01", customer="sheng_shiong"), _row("2026-09-01", product="Aire Ultra Tape XL", sku="13271342")]

    assert forecast_summary.resolve_scope(rows, "ultra tape l", "Sheng Shiong") == ("Aire Ultra Tape L", "sheng_shiong")
    assert forecast_summary.resolve_scope(rows, "13271342", None) == ("Aire Ultra Tape XL", None)


def test_ambiguous_product_raises_naming_the_matches():
    rows = [_row("2026-09-01"), _row("2026-09-01", product="Aire Ultra Tape XL", sku="2")]

    with pytest.raises(ValueError, match="more than one product"):
        forecast_summary.resolve_scope(rows, "tape", None)


def test_unknown_customer_raises_listing_customers_with_a_forecast():
    with pytest.raises(ValueError, match="Customers with a forecast: fairprice"):
        forecast_summary.resolve_scope([_row("2026-09-01")], None, "nhg")


def test_window_defaults_to_first_three_forecast_months():
    rows = [_row(month) for month in ("2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01")]

    assert forecast_summary.forecast_window(rows, None, None) == _window("2026-09-01", "2026-11-01")


def test_window_with_only_a_start_is_that_month():
    assert forecast_summary.forecast_window([], "2026-11", None) == _window("2026-11-01", "2026-11-01")


def test_window_rejects_bad_month_format():
    with pytest.raises(ValueError, match="YYYY-MM"):
        forecast_summary.forecast_window([], "November", None)


# ---- summarise --------------------------------------------------------------

def test_single_series_keeps_forecast_and_actuals_separate():
    rows = [_row("2026-09-01", current=52.4, low=32.41, high=79.3), _row("2026-10-01", current=51.6)]
    actuals = [_actual("2026-06-01", 16), _actual("2026-07-01", 53), _actual("2026-08-01", 88)]

    result = forecast_summary.summarise(
        rows, actuals, "Aire Ultra Tape L", "fairprice", _window("2026-09-01", "2026-10-01"), _FRESHNESS, _TODAY
    )

    [series] = result["series"]
    assert series["sku"] == "13271338"
    assert series["forecast"] == [
        {"month": "2026-09-01", "cartons": 52, "low_80": 32, "high_80": 79, "revenue": None},
        {"month": "2026-10-01", "cartons": 52, "low_80": 30, "high_80": 80, "revenue": None},
    ]
    assert [a["cartons"] for a in series["actuals"]] == [16, 53, 88]
    assert series["confidence"]["label"] == "Low"
    # The rounded sum of the raw values, not 52 + 52.
    assert result["forecast_total_cartons"] == 104
    assert result["monthly_totals"] == []
    assert result["forecast_generated_at_sgt"] == "5 Oct 2026, 1:14 am"


def test_recent_actuals_are_the_latest_months_with_sales_not_calendar_months():
    rows = [_row("2026-11-01")]
    actuals = [_actual("2026-07-01", 53), _actual("2026-08-01", 88)]

    result = forecast_summary.summarise(rows, actuals, None, None, _window("2026-11-01", "2026-11-01"), _FRESHNESS, _TODAY)

    # September and October have no sales yet; July and August still show.
    assert [a["month"] for a in result["series"][0]["actuals"]] == ["2026-07-01", "2026-08-01"]


def test_current_month_actual_is_flagged_month_to_date():
    rows = [_row("2026-10-01")]
    actuals = [_actual("2026-10-01", 20)]

    result = forecast_summary.summarise(rows, actuals, None, None, _window("2026-10-01", "2026-10-01"), _FRESHNESS, _TODAY)

    assert result["series"][0]["actuals"] == [{"month": "2026-10-01", "cartons": 20, "revenue": None, "month_to_date": True}]


def test_several_series_get_month_totals_like_the_all_skus_view():
    rows = [_row("2026-11-01", current=561.4), _row("2026-11-01", product="Aire Ultra Tape XL", sku="2", current=22.9)]
    actuals = [_actual("2026-07-01", 10), _actual("2026-08-01", 88), _actual("2026-08-01", 5, product="Aire Ultra Tape XL")]

    result = forecast_summary.summarise(rows, actuals, None, "fairprice", _window("2026-11-01", "2026-11-01"), _FRESHNESS, _TODAY)

    assert len(result["series"]) == 2
    # Many series: only the latest actual month is shown.
    assert {a["month"] for s in result["series"] for a in s["actuals"]} == {"2026-08-01"}
    assert result["monthly_totals"] == [
        {"month": "2026-08-01", "forecast_cartons": None, "forecast_revenue": None,
         "actual_cartons": 93, "actual_revenue": None, "actual_month_to_date": False},
        {"month": "2026-11-01", "forecast_cartons": 584, "forecast_revenue": None,
         "actual_cartons": None, "actual_revenue": None, "actual_month_to_date": False},
    ]


# ---- Revenue matches the page's Revenue view ---------------------------------

def test_forecast_revenue_is_cartons_at_realised_price_like_the_page():
    rows = [_row("2026-09-01", current=52.4), _row("2026-10-01", current=51.6)]
    actuals = [_actual("2026-08-01", 88, revenue=712.3)]

    result = forecast_summary.summarise(
        rows, actuals, None, None, _window("2026-09-01", "2026-10-01"), _FRESHNESS, _TODAY,
        prices={(1, "13271338"): 8.333},
    )

    [series] = result["series"]
    # Priced from the raw cartons, as forecast_service.add_forecast_revenue does.
    assert [e["revenue"] for e in series["forecast"]] == [round(52.4 * 8.333, 2), round(51.6 * 8.333, 2)]
    assert series["realised_price"] == 8.33
    assert series["actuals"][0]["revenue"] == 712.3
    assert result["forecast_total_revenue"] == round(round(52.4 * 8.333, 2) + round(51.6 * 8.333, 2), 2)
    assert "realised price" in result["revenue_basis"]


def test_sku_without_a_price_has_no_revenue_and_totals_skip_it():
    rows = [_row("2026-11-01", current=10), _row("2026-11-01", product="Aire Ultra Tape XL", sku="2", current=20)]

    result = forecast_summary.summarise(
        rows, [], None, None, _window("2026-11-01", "2026-11-01"), _FRESHNESS, _TODAY,
        prices={(1, "13271338"): 5.0},
    )

    by_product = {item["product_name"]: item for item in result["series"]}
    assert by_product["Aire Ultra Tape XL"]["forecast"][0]["revenue"] is None
    assert result["monthly_totals"][0]["forecast_revenue"] == 50.0
    assert result["monthly_totals"][0]["forecast_cartons"] == 30


# ---- get_demand_forecast reads what the page reads -------------------------

def test_get_demand_forecast_reads_actuals_for_the_resolved_scope(monkeypatch):
    calls = {}
    monkeypatch.setattr(forecast_summary.bigquery_service, "get_forecast_output_rows", lambda: [_row("2026-09-01")])

    def fake_actuals(**kwargs):
        calls["actuals"] = kwargs
        return [_actual("2026-08-01", 88)]

    def fake_loaded(**kwargs):
        calls["loaded"] = kwargs
        return "2026-10-06T05:05:11Z"

    def fake_prices(**kwargs):
        calls["prices"] = kwargs
        return {(1, "13271338"): 8.5}

    monkeypatch.setattr(forecast_summary.bigquery_service, "get_forecast_actuals", fake_actuals)
    monkeypatch.setattr(forecast_summary.bigquery_service, "get_sales_loaded_at", fake_loaded)
    monkeypatch.setattr(forecast_summary.bigquery_service, "get_realised_prices", fake_prices)

    result = forecast_summary.get_demand_forecast(product="ultra tape l", customer="FairPrice", today=_TODAY)

    assert calls["prices"] == {"product_name": "Aire Ultra Tape L", "customer_name": "fairprice"}
    assert calls["actuals"] == {
        "product_name": "Aire Ultra Tape L",
        "customer_name": "fairprice",
        "start_date": "2026-03-01",
        "end_date": "2026-11-30",
    }
    assert calls["loaded"] == {"customer_name": "fairprice"}
    assert result["series"][0]["forecast"][0]["cartons"] == 52
    assert result["actuals_loaded_at_sgt"] == "6 Oct 2026, 1:05 pm"


def test_get_demand_forecast_with_no_forecast_raises_without_reading_actuals(monkeypatch):
    monkeypatch.setattr(forecast_summary.bigquery_service, "get_forecast_output_rows", lambda: [_row("2026-09-01", current=None)])

    def _no_reads_allowed(**kwargs):
        raise AssertionError("should not read actuals")

    monkeypatch.setattr(forecast_summary.bigquery_service, "get_forecast_actuals", _no_reads_allowed)
    monkeypatch.setattr(forecast_summary.bigquery_service, "get_sales_loaded_at", _no_reads_allowed)

    with pytest.raises(ValueError, match="no forecast"):
        forecast_summary.get_demand_forecast(customer="fairprice")
