"""
Dashboard/inventory reads in sellout_service.py -- ported from bigquery.py so
the Sales Dashboard and Inventory read Cloud SQL directly instead of a
Datastream replica, and so both honor the same monthly-preferred-over-weekly
selection rule (EFFECTIVE_SELLOUT_CTE) for a retailer+month that has only
monthly-granularity rows.
"""

from datetime import date

import pandas as pd
import pytest
from conftest import FakeConnection, FakeEngine

from app.services import sellout_service


def _install(monkeypatch, respond=None):
    conn = FakeConnection(respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(sellout_service, "_get_read_engine", lambda: engine)
    return conn


def _no_engine_allowed(monkeypatch):
    def _raise():
        raise AssertionError("Cloud SQL must not be called")

    monkeypatch.setattr(sellout_service, "_get_read_engine", _raise)


# ---- get_sku_ranking ---------------------------------------------------

def test_sku_ranking_validates_before_querying(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="metric"):
        sellout_service.get_sku_ranking(metric="revenue")
    with pytest.raises(ValueError, match="order"):
        sellout_service.get_sku_ranking(order="sideways")
    with pytest.raises(ValueError, match="mode"):
        sellout_service.get_sku_ranking(mode="instore")


def test_sku_ranking_reads_through_effective_sellout(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_sku_ranking(customer="fairprice")

    (sql, _params) = conn.calls[0]
    assert "effective_sellout" in sql
    assert "monthly_coverage" in sql


def test_sku_ranking_order_by_has_no_secondary_sort_key(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_sku_ranking(metric="volume", order="asc", customer="fairprice")

    (sql, _params) = conn.calls[0]
    assert "ORDER BY volume ASC" in sql
    assert sql.rstrip().endswith("ORDER BY volume ASC")


def test_sku_ranking_mode_scopes_to_one_retailer(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_sku_ranking(customer="fairprice", mode="offline")

    (_sql, params) = conn.calls[0]
    assert params["retailer_names"] == ["fairprice_offline"]


def test_sku_ranking_shapes_rank_and_rounds_value(monkeypatch):
    # product_name's "no SKU in the catalog" fallback is SQL-side
    # (COALESCE(MAX(k.product_name), s.sku)), not re-applied in Python.
    rows = [
        {"sku": "A1", "product_name": "Pants A", "volume": 100.0, "value": 500.123},
        {"sku": "A2", "product_name": "Pants B", "volume": 50.0, "value": 200.0},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    df = sellout_service.get_sku_ranking(customer="fairprice")

    assert list(df["rank"]) == [1, 2]
    assert df.iloc[0]["value"] == 500.12


def test_sku_ranking_empty_result_returns_the_right_columns(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    df = sellout_service.get_sku_ranking(customer="fairprice")

    assert list(df.columns) == sellout_service.SKU_RANKING_COLUMNS
    assert df.empty


def _catalog_row(sku, product_name, sku_range, size, value):
    return {"sku": sku, "product_name": product_name, "sku_range": sku_range, "size": size,
            "volume": value / 10, "value": value}


def test_sku_ranking_product_order_lists_the_clients_order_and_keeps_metric_rank(monkeypatch):
    # SQL returns highest value first (the rank order); product order then
    # lists range by range (Adult Pants, Ultra Tape, Ultra Pants), S/M-L-XL.
    rows = [
        _catalog_row("UP-L", "Aire Ultra Pants L", "Aire Adult Diaper Ultra Pants", "L", 900.0),
        _catalog_row("AP-XL", "Aire Adult Pants XL", "Aire Adult Diaper Pants", "XL", 800.0),
        _catalog_row("UT-SM", "Aire Ultra Tape S/M", "Aire Adult Diaper Ultra Tape", "S/M", 700.0),
        _catalog_row("AP-SM", "Aire Adult Pants S/M", "Aire Adult Diaper Pants", "S/M", 600.0),
        _catalog_row("NEW", "Something New", None, None, 500.0),
    ]
    conn = _install(monkeypatch, lambda sql, params: rows)

    ranked = sellout_service.get_sku_ranking(order="product", customer="fairprice")

    assert list(ranked["sku"]) == ["AP-SM", "AP-XL", "UT-SM", "UP-L", "NEW"]
    assert list(ranked["rank"]) == [4, 2, 3, 1, 5]
    (sql, _params) = conn.calls[0]
    assert "ORDER BY value DESC" in sql


def test_sku_ranking_rejects_an_unknown_order(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="order"):
        sellout_service.get_sku_ranking(order="alphabetical")


# ---- get_sku_options / get_store_options / get_customer_options --------

def test_sku_options_include_both_week_and_month_rows(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_sku_options(customer="fairprice")

    (sql, _params) = conn.calls[0]
    assert "period_type IN ('week', 'month')" in sql


def test_sku_options_are_ordered_by_range_then_size(monkeypatch):
    rows = [
        {"sku": "T-XL", "product_name": "Tape XL", "sku_range": "Tape", "size": "XL"},
        {"sku": "T-L", "product_name": "Tape L", "sku_range": "Tape", "size": "L"},
        {"sku": "P-L", "product_name": "Pants L", "sku_range": "Pants", "size": "L"},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    options = sellout_service.get_sku_options(customer="fairprice")

    assert [o["sku"] for o in options] == ["P-L", "T-L", "T-XL"]


def test_sku_options_follow_the_clients_range_order_not_alphabetical(monkeypatch):
    rows = [
        {"sku": "UP-SM", "product_name": "Aire Ultra Pants S/M", "sku_range": "Aire Adult Diaper Ultra Pants", "size": "S/M"},
        {"sku": "UT-L", "product_name": "Aire Ultra Tape L", "sku_range": "Aire Adult Diaper Ultra Tape", "size": "L"},
        {"sku": "AP-XL", "product_name": "Aire Adult Pants XL", "sku_range": "Aire Adult Diaper Pants", "size": "XL"},
        {"sku": "UT-SM", "product_name": "Aire Ultra Tape S/M", "sku_range": "Aire Adult Diaper Ultra Tape", "size": "S/M"},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    options = sellout_service.get_sku_options(customer="fairprice")

    assert [o["sku"] for o in options] == ["AP-XL", "UT-SM", "UT-L", "UP-SM"]


def test_store_options_dedupe_by_code_keeping_first_name(monkeypatch):
    rows = [
        {"store_code": "100", "store_name": None},
        {"store_code": "100", "store_name": "Main Branch"},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    options = sellout_service.get_store_options(customer="fairprice")

    assert options == [{"store_code": "100", "store_name": "Main Branch"}]


def test_customer_options_have_no_period_type_filter(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_customer_options()

    (sql, _params) = conn.calls[0]
    assert "period_type" not in sql


def test_customer_options_strip_the_channel_suffix(monkeypatch):
    rows = [("fairprice_offline",), ("fairprice_online",)]
    _install(monkeypatch, lambda sql, params: rows)

    options = sellout_service.get_customer_options()

    assert options == [{"value": "fairprice", "label": "Fairprice"}]


# ---- get_data_freshness -------------------------------------------------

def test_data_freshness_has_no_customer_filter(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_data_freshness()

    (sql, params) = conn.calls[0]
    assert params is None or "retailer_name" not in (params or {})


def test_data_freshness_is_sent_in_utc(monkeypatch):
    # TIMESTAMPTZ comes back timezone-aware; the frontend shows it in Singapore time.
    loaded_at = pd.Timestamp("2026-09-11 16:43:00", tz="Asia/Singapore")
    _install(monkeypatch, lambda sql, params: [{"retailer_name": "fairprice_offline", "loaded_at": loaded_at}])

    freshness = sellout_service.get_data_freshness()

    assert freshness == {"fairprice_offline": "2026-09-11T08:43:00Z"}


def test_data_freshness_treats_a_naive_loaded_at_as_utc(monkeypatch):
    loaded_at = pd.Timestamp("2026-09-11 08:43:00")
    _install(monkeypatch, lambda sql, params: [{"retailer_name": "fairprice_online", "loaded_at": loaded_at}])

    freshness = sellout_service.get_data_freshness()

    assert freshness == {"fairprice_online": "2026-09-11T08:43:00Z"}


# ---- get_dashboard_summary -----------------------------------------------

def test_dashboard_summary_validates_granularity(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="granularity"):
        sellout_service.get_dashboard_summary(granularity="year")


def test_dashboard_summary_month_granularity_uses_effective_sellout(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_dashboard_summary(granularity="month", customer="fairprice")

    (sql, _params) = conn.calls[0]
    assert "effective_sellout" in sql
    assert "monthly_coverage" in sql


def test_dashboard_summary_week_granularity_reads_genuine_weeks_only(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_dashboard_summary(granularity="week", customer="fairprice")

    (sql, _params) = conn.calls[0]
    assert "effective_sellout" not in sql
    assert "period_type = 'week'" in sql


def test_dashboard_summary_empty_result_gives_empty_shape_for_both_modes(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    result = sellout_service.get_dashboard_summary(customer="fairprice")

    assert result == {
        "offline": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }


def test_dashboard_summary_rolls_up_by_retailer_format_and_month(monkeypatch):
    rows = [
        {"retailer_id": 55, "retailer": "fairprice_online", "store_code": "001", "format": "ONLINE",
         "period_start": date(2026, 1, 5), "revenue": 100.0, "units": 10.0},
        {"retailer_id": 55, "retailer": "fairprice_online", "store_code": "001", "format": "ONLINE",
         "period_start": date(2026, 1, 12), "revenue": 50.0, "units": 5.0},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    result = sellout_service.get_dashboard_summary(granularity="month", customer="fairprice")

    period_total = result["online"]["periodTotal"]
    assert len(period_total) == 1
    assert period_total[0]["period_label"] == "January 2026"
    assert period_total[0]["revenue"] == 150.0
    assert period_total[0]["units"] == 15.0
    assert isinstance(period_total[0]["period_start"], date)
    assert not isinstance(period_total[0]["period_start"], pd.Timestamp)
    assert result["offline"] == {"storeFormats": [], "periodTotal": [], "periodByFormat": []}


# ---- get_monthly_only_months ---------------------------------------------

def test_monthly_only_validates_dates_before_querying(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="start_date"):
        sellout_service.get_monthly_only_months(start_date="Aug 2026")


def test_monthly_only_lists_each_channels_months_sorted_and_deduplicated(monkeypatch):
    rows = [
        {"retailer": "fairprice_offline", "month": date(2026, 8, 1)},
        {"retailer": "fairprice_offline", "month": date(2026, 6, 1)},
        {"retailer": "fairprice_online", "month": date(2026, 8, 1)},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    result = sellout_service.get_monthly_only_months(customer="fairprice")

    assert result == {"offline": ["2026-06-01", "2026-08-01"], "online": ["2026-08-01"]}


def test_monthly_only_with_no_monthly_only_months_gives_empty_lists(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    assert sellout_service.get_monthly_only_months(customer="fairprice") == {"offline": [], "online": []}


def test_monthly_only_reads_month_rows_without_weeks_in_the_dashboard_scope(monkeypatch):
    conn = _install(monkeypatch, lambda sql, params: [])

    sellout_service.get_monthly_only_months(
        customer="fairprice", sku="A1", start_date="2026-07-01", end_date="2026-08-31"
    )

    (sql, params) = conn.calls[0]
    assert "s.period_type = 'month'" in sql
    assert "NOT EXISTS" in sql and "w.period_type = 'week'" in sql
    assert "s.sku = :sku" in sql
    assert params["retailer_names"] == ["fairprice_offline", "fairprice_online"]
    assert params["start_date"] == "2026-07-01"
    assert params["end_date"] == "2026-08-31"


# ---- get_default_date_range ----------------------------------------------

def _latest_and_earliest(latest_rows, earliest, latest_week=date(2026, 7, 30)):
    # The latest-period query gets `latest_rows`, the MIN(period_start) one
    # `earliest`, and the latest-genuine-week one `latest_week`.
    def respond(sql, params):
        if "MIN(period_start)" in sql:
            return [{"earliest_start": earliest}]
        if "period_type = 'week'" in sql and "effective_sellout" not in sql:
            return [(latest_week,)]
        return latest_rows

    return respond


def test_default_date_range_validates_period_and_mode(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="period"):
        sellout_service.get_default_date_range(period="fortnight")
    with pytest.raises(ValueError, match="mode"):
        sellout_service.get_default_date_range(mode="instore")


def test_default_date_range_with_no_data_returns_nulls(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    result = sellout_service.get_default_date_range(customer="fairprice")

    assert result == {
        "start": None, "end": None, "period_type": None, "earliest_start": None, "latest_week_start": None,
    }


def test_default_date_range_week_returns_the_latest_preferred_period_as_is(monkeypatch):
    # The core fix: when the latest preferred period is a whole month (no
    # real weekly rows for it), period='week' must return that month's
    # bounds directly, not fabricate a week from it.
    rows = [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
    _install(monkeypatch, _latest_and_earliest(rows, date(2024, 1, 4)))

    result = sellout_service.get_default_date_range(customer="fairprice", period="week")

    assert result == {
        "start": "2026-08-01",
        "end": "2026-08-31",
        "period_type": "month",
        "earliest_start": "2024-01-04",
        "latest_week_start": "2026-07-30",
    }


def test_default_date_range_earliest_start_is_scoped_to_the_channel(monkeypatch):
    rows = [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
    conn = _install(monkeypatch, _latest_and_earliest(rows, date(2024, 1, 4)))

    sellout_service.get_default_date_range(customer="fairprice", mode="offline")

    [(_sql, params)] = conn.sql_containing("MIN(period_start)")
    assert params == {"retailer_name": "fairprice_offline"}


def test_default_date_range_month_spans_count_back_from_the_latest_periods_month(monkeypatch):
    rows = [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
    _install(monkeypatch, _latest_and_earliest(rows, date(2024, 1, 4)))

    result = sellout_service.get_default_date_range(customer="fairprice", period="6months")

    assert result["start"] == "2026-03-01"
    assert result["end"] == "2026-08-31"


# ---- get_period_comparison -----------------------------------------------

def test_period_comparison_validates_comparison_type_and_mode(monkeypatch):
    _no_engine_allowed(monkeypatch)
    with pytest.raises(ValueError, match="comparison_type"):
        sellout_service.get_period_comparison(comparison_type="qoq")
    with pytest.raises(ValueError, match="mode"):
        sellout_service.get_period_comparison(mode="instore")


def test_period_comparison_without_mode_has_no_retailer_filter(monkeypatch):
    # Locked-in pre-existing quirk, preserved bug-for-bug across this
    # migration: omitting mode means no retailer/customer scoping at all,
    # not "both channels of the given customer".
    conn = _install(
        monkeypatch,
        lambda sql, params: [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
        if "effective_sellout" in sql and "LIMIT 1" in sql
        else [],
    )

    sellout_service.get_period_comparison(customer="fairprice")

    main_query = conn.calls[-1]
    sql, params = main_query
    assert "retailer_name" not in params
    assert "retailers" not in sql


def test_period_comparison_wow_reads_genuine_weeks_not_effective_sellout(monkeypatch):
    # Regression test for a real bug found while verifying this migration
    # live: wow's SUM query used to read effective_sellout too, so a
    # monthly row's single period_start landing inside the 7-day window
    # silently inflated "this week" into "this whole month".
    calls = []

    def respond(sql, params):
        calls.append(sql)
        if "ORDER BY period_start DESC" in sql:
            return [(date(2026, 8, 1),)]
        return [{"current_revenue": 10.0, "current_units": 1.0, "previous_revenue": 5.0,
                  "previous_units": 1.0, "previous_row_count": 1}]

    _install(monkeypatch, respond)

    sellout_service.get_period_comparison(comparison_type="wow", customer="fairprice", mode="offline")

    main_query_sql = calls[-1]
    assert "effective_sellout" not in main_query_sql
    assert "period_type = 'week'" in main_query_sql


def test_period_comparison_mom_reads_through_effective_sellout(monkeypatch):
    def respond(sql, params):
        if "ORDER BY period_end DESC" in sql:
            return [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
        return [{"current_revenue": 10.0, "current_units": 1.0, "previous_revenue": 5.0,
                  "previous_units": 1.0, "previous_row_count": 1}]

    conn = _install(monkeypatch, respond)

    result = sellout_service.get_period_comparison(comparison_type="mom", customer="fairprice", mode="offline")

    assert result["current"]["start"] == "2026-08-01"
    main_query_sql = conn.calls[-1][0]
    assert "effective_sellout" in main_query_sql


def test_period_comparison_no_data_returns_the_empty_shape(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    result = sellout_service.get_period_comparison(customer="fairprice", mode="offline")

    assert result == sellout_service._empty_period_comparison()


def test_period_comparison_available_is_true_only_when_previous_has_rows(monkeypatch):
    def respond(sql, params):
        if "ORDER BY period_end DESC" in sql:
            return [{"period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31), "period_type": "month"}]
        return [{"current_revenue": 10.0, "current_units": 1.0, "previous_revenue": 0.0,
                  "previous_units": 0.0, "previous_row_count": 0}]

    _install(monkeypatch, respond)

    result = sellout_service.get_period_comparison(customer="fairprice", mode="offline")

    assert result["previous"]["available"] is False
