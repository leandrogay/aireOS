from datetime import date

from conftest import FakeConnection, FakeEngine

from app.services import sellout_units


def _install(monkeypatch, respond=None):
    conn = FakeConnection(respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(sellout_units, "_get_read_engine", lambda: engine)
    return conn


def test_the_retailer_ids_are_a_bound_array_parameter(monkeypatch):
    conn = _install(monkeypatch)

    sellout_units.get_monthly_sellout([55, 57])

    (sql, params) = conn.calls[0]
    assert params["retailer_ids"] == [55, 57]
    assert "retailer_id = ANY(CAST(:retailer_ids AS integer[]))" in sql


def test_the_query_reads_through_the_shared_effective_sellout_view(monkeypatch):
    # Inventory must use the same monthly-preferred-over-weekly selection
    # rule as the dashboard, not a raw period_type='week' filter -- otherwise
    # a retailer+month that only has monthly-granularity data (e.g. August
    # 2026) would silently show zero sell-out here even once the dashboard
    # is fixed.
    conn = _install(monkeypatch)

    sellout_units.get_monthly_sellout([55])

    (sql, _params) = conn.calls[0]
    assert "effective_sellout" in sql
    assert "monthly_coverage" in sql
    assert "FROM effective_sellout" in sql


def test_weeks_are_counted_in_the_month_they_start_in(monkeypatch):
    conn = _install(monkeypatch)

    sellout_units.get_monthly_sellout([55])

    (sql, _params) = conn.calls[0]
    assert "date_trunc('month', period_start)" in sql


def test_units_are_keyed_by_sku_and_first_of_month(monkeypatch):
    rows = [
        {"sku": "A", "month": date(2026, 6, 1), "units": 100.0, "data_through": date(2026, 6, 24)},
        {"sku": "A", "month": date(2026, 7, 1), "units": 120.0, "data_through": date(2026, 8, 5)},
        {"sku": "B", "month": date(2026, 6, 1), "units": 7.0, "data_through": date(2026, 7, 1)},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    units, _ = sellout_units.get_monthly_sellout([55])

    assert units == {"A": {date(2026, 6, 1): 100.0, date(2026, 7, 1): 120.0}, "B": {date(2026, 6, 1): 7.0}}


def test_a_month_with_only_a_null_sum_falls_back_to_zero_not_a_crash(monkeypatch):
    rows = [{"sku": "A", "month": date(2026, 6, 1), "units": None, "data_through": date(2026, 6, 24)}]
    _install(monkeypatch, lambda sql, params: rows)

    units, _ = sellout_units.get_monthly_sellout([55])

    assert units == {"A": {date(2026, 6, 1): 0.0}}


def test_data_through_is_the_latest_day_any_row_covers(monkeypatch):
    rows = [
        {"sku": "A", "month": date(2026, 6, 1), "units": 1.0, "data_through": date(2026, 7, 1)},
        {"sku": "A", "month": date(2026, 7, 1), "units": 1.0, "data_through": date(2026, 8, 19)},
    ]
    _install(monkeypatch, lambda sql, params: rows)

    _, data_through = sellout_units.get_monthly_sellout([55])

    assert data_through == date(2026, 8, 19)


def test_no_rows_gives_no_units_and_no_data_through(monkeypatch):
    _install(monkeypatch, lambda sql, params: [])

    assert sellout_units.get_monthly_sellout([55]) == ({}, None)


def test_a_customer_with_no_retailers_skips_the_query(monkeypatch):
    def _no_engine_allowed():
        raise AssertionError("Cloud SQL must not be called")

    monkeypatch.setattr(sellout_units, "_get_read_engine", _no_engine_allowed)

    assert sellout_units.get_monthly_sellout([]) == ({}, None)


def test_a_connection_already_in_a_transaction_is_reused_not_opened_again(monkeypatch):
    # _require_sellout_coverage passes its own write-transaction connection
    # through so the coverage check reads inside that same transaction,
    # instead of checking out a second pooled connection while it's open.
    def _no_engine_allowed():
        raise AssertionError("must not open a new connection when one was given")

    monkeypatch.setattr(sellout_units, "_get_read_engine", _no_engine_allowed)
    conn = FakeConnection(lambda sql, params: [])

    assert sellout_units.get_monthly_sellout([55], conn=conn) == ({}, None)
    assert len(conn.calls) == 1
