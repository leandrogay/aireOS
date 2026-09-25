from datetime import date

import pandas as pd

from app.services import bigquery, sellout_units


class FakeBigQueryClient:
    """Records the query and its parameters, returns a canned frame."""

    def __init__(self, frame):
        self._frame = frame
        self.last_query = None
        self.last_job_config = None

    def query(self, query, job_config=None):
        self.last_query = query
        self.last_job_config = job_config
        return self

    def result(self):
        return self

    def to_dataframe(self):
        return self._frame


COLUMNS = ["sku", "month", "units", "data_through"]


def _install(monkeypatch, frame):
    client = FakeBigQueryClient(frame)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)
    return client


def test_the_retailer_ids_are_a_bound_array_parameter(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    sellout_units.get_monthly_sellout([55, 57])

    (param,) = client.last_job_config.query_parameters
    assert param.name == "retailer_ids"
    assert list(param.values) == [55, 57]
    assert "IN UNNEST(@retailer_ids)" in client.last_query


def test_only_weekly_rows_are_read(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    sellout_units.get_monthly_sellout([55])

    assert "period_type = 'week'" in client.last_query


def test_weeks_are_counted_in_the_month_they_start_in(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    sellout_units.get_monthly_sellout([55])

    assert "DATE_TRUNC(period_start, MONTH)" in client.last_query


def test_units_are_keyed_by_sku_and_first_of_month(monkeypatch):
    frame = pd.DataFrame(
        [
            {"sku": "A", "month": pd.Timestamp("2026-06-01"), "units": 100.0, "data_through": pd.Timestamp("2026-06-24")},
            {"sku": "A", "month": date(2026, 7, 1), "units": 120.0, "data_through": pd.Timestamp("2026-08-05")},
            {"sku": "B", "month": pd.Timestamp("2026-06-01"), "units": 7.0, "data_through": pd.Timestamp("2026-07-01")},
        ]
    )
    _install(monkeypatch, frame)

    units, _ = sellout_units.get_monthly_sellout([55])

    assert units == {"A": {date(2026, 6, 1): 100.0, date(2026, 7, 1): 120.0}, "B": {date(2026, 6, 1): 7.0}}


def test_data_through_is_the_latest_day_any_row_covers(monkeypatch):
    frame = pd.DataFrame(
        [
            {"sku": "A", "month": pd.Timestamp("2026-06-01"), "units": 1.0, "data_through": pd.Timestamp("2026-07-01")},
            {"sku": "A", "month": pd.Timestamp("2026-07-01"), "units": 1.0, "data_through": pd.Timestamp("2026-08-19")},
        ]
    )
    _install(monkeypatch, frame)

    _, data_through = sellout_units.get_monthly_sellout([55])

    assert data_through == date(2026, 8, 19)


def test_no_rows_gives_no_units_and_no_data_through(monkeypatch):
    _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    assert sellout_units.get_monthly_sellout([55]) == ({}, None)


def test_a_customer_with_no_retailers_skips_the_query(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery must not be called")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)

    assert sellout_units.get_monthly_sellout([]) == ({}, None)
