from datetime import date

import pandas as pd
import pytest
from google.api_core.exceptions import GoogleAPICallError

from app.services import bigquery, forecast_units


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

    def result(self, timeout=None):
        self.last_timeout = timeout
        return self

    def to_dataframe(self, create_bqstorage_client=True):
        return self._frame


def _install(monkeypatch, frame):
    client = FakeBigQueryClient(frame)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)
    return client


COLUMNS = ["customer_id", "sku", "month_year", "tier", "forecast_current"]


def test_the_customer_filter_is_not_pushed_into_the_view(monkeypatch):
    # A customer filter made the view's window functions slower to run, so the
    # small view is read whole and the customer is picked out in Python.
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    forecast_units.get_forecast_units(7)

    assert "customer_id =" not in client.last_query
    assert "UNNEST" not in client.last_query


def test_only_the_asked_for_customer_is_returned(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 2, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 20.0},
        ]
    )
    _install(monkeypatch, frame)

    assert forecast_units.get_forecast_units(2) == {"A1": {date(2026, 8, 1): 20.0}}


def test_only_rows_with_a_forecast_are_read(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    forecast_units.get_forecast_units(1)

    assert "forecast_current IS NOT NULL" in client.last_query


def test_predictions_are_keyed_by_sku_and_first_of_month(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 1310.0},
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 9, 1), "forecast_current": 1984.0},
            {"customer_id": 1, "tier": "tier0", "sku": "B1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 44.0},
        ]
    )
    _install(monkeypatch, frame)

    forecast = forecast_units.get_forecast_units(1)

    assert forecast == {
        "A1": {date(2026, 8, 1): 1310.0, date(2026, 9, 1): 1984.0},
        "B1": {date(2026, 8, 1): 44.0},
    }


def test_only_tier_0_is_used_so_months_are_not_tripled(monkeypatch):
    # The view has a row per model; Inventory plans on Tier 0 only.
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 1, "tier": "tier1_basic", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 99.0},
            {"customer_id": 1, "tier": "tier1_advanced", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 77.0},
        ]
    )
    client = _install(monkeypatch, frame)

    assert forecast_units.get_forecast_units(1) == {"A1": {date(2026, 8, 1): 10.0}}
    assert "tier" in client.last_query


def test_no_rows_gives_an_empty_forecast(monkeypatch):
    _install(monkeypatch, pd.DataFrame(columns=COLUMNS))

    assert forecast_units.get_forecast_units(1) == {}


# ---- several customers in one query ----


def test_several_customers_are_read_in_one_query(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=COLUMNS))
    queries = []
    record = client.query
    client.query = lambda query, job_config=None: queries.append(query) or record(query, job_config)

    forecast_units.get_forecast_units_by_customer([1, 2, 3])

    assert len(queries) == 1


def test_predictions_are_grouped_by_customer(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 2, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 20.0},
        ]
    )
    _install(monkeypatch, frame)

    forecast = forecast_units.get_forecast_units_by_customer([1, 2])

    assert forecast == {
        1: {"A1": {date(2026, 8, 1): 10.0}},
        2: {"A1": {date(2026, 8, 1): 20.0}},
    }


def test_customers_not_asked_for_are_left_out(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 3, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 30.0},
        ]
    )
    _install(monkeypatch, frame)

    assert set(forecast_units.get_forecast_units_by_customer([1, 2])) == {1}


def test_no_customers_skips_bigquery(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery must not be called")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)

    assert forecast_units.get_forecast_units_by_customer([]) == {}


# ---- current and initial lines together (sell-in plan) ----

LINE_COLUMNS = ["customer_id", "sku", "month_year", "tier", "forecast_current", "forecast_previous", "forecast_initial"]


def test_both_lines_are_read_in_one_query(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=LINE_COLUMNS))

    forecast_units.get_forecast_lines(1)

    assert "forecast_previous IS NOT NULL" in client.last_query
    assert "forecast_initial IS NOT NULL" in client.last_query
    assert "customer_id =" not in client.last_query


def test_each_line_keeps_only_the_months_it_has(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": None, "forecast_previous": 55.0, "forecast_initial": 50.0},
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": pd.Timestamp("2026-10-01"), "forecast_current": 70.0, "forecast_previous": None, "forecast_initial": 60.0},
            {"customer_id": 2, "tier": "tier0", "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 9.0, "forecast_previous": 9.0, "forecast_initial": 9.0},
        ]
    )
    _install(monkeypatch, frame)

    assert forecast_units.get_forecast_lines(1) == {
        "current": {"A1": {date(2026, 10, 1): 70.0}},
        "previous": {"A1": {date(2026, 8, 1): 55.0}},
        "initial": {"A1": {date(2026, 8, 1): 50.0, date(2026, 10, 1): 60.0}},
    }


def test_lines_use_only_tier_0(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 10, 1), "forecast_current": 70.0, "forecast_previous": 65.0, "forecast_initial": 60.0},
            {"customer_id": 1, "tier": "tier1_basic", "sku": "A1", "month_year": date(2026, 10, 1), "forecast_current": 99.0, "forecast_previous": 98.0, "forecast_initial": 97.0},
            {"customer_id": 1, "tier": "tier1_advanced", "sku": "A1", "month_year": date(2026, 10, 1), "forecast_current": 77.0, "forecast_previous": 76.0, "forecast_initial": 75.0},
        ]
    )
    client = _install(monkeypatch, frame)

    assert forecast_units.get_forecast_lines(1) == {
        "current": {"A1": {date(2026, 10, 1): 70.0}},
        "previous": {"A1": {date(2026, 10, 1): 65.0}},
        "initial": {"A1": {date(2026, 10, 1): 60.0}},
    }
    assert "tier" in client.last_query


def test_no_rows_gives_three_empty_lines(monkeypatch):
    _install(monkeypatch, pd.DataFrame(columns=LINE_COLUMNS))

    assert forecast_units.get_forecast_lines(1) == {"current": {}, "previous": {}, "initial": {}}


# ---- a read that takes too long ----


class HangingJob:
    """A query job that never finishes in time."""

    def __init__(self):
        self.cancelled = False

    def result(self, timeout=None):
        raise TimeoutError()

    def cancel(self):
        self.cancelled = True


class HangingClient:
    def __init__(self):
        self.job = HangingJob()

    def query(self, query, job_config=None):
        return self.job


def test_every_forecast_read_has_a_time_limit(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=LINE_COLUMNS))

    forecast_units.get_forecast_lines(1)

    assert client.last_timeout == forecast_units.FORECAST_QUERY_TIMEOUT_SECONDS


@pytest.mark.parametrize("read", [lambda: forecast_units.get_forecast_lines(1), lambda: forecast_units.get_forecast_units(1)])
def test_a_read_past_the_limit_is_stopped_and_raised_as_a_google_api_error(monkeypatch, read):
    client = HangingClient()
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)

    with pytest.raises(GoogleAPICallError, match="took longer than 120 seconds"):
        read()
    assert client.job.cancelled


# ---- lines for several customers in one read (sell-in snapshots) ----


def test_several_customers_lines_come_from_one_query(monkeypatch):
    frame = pd.DataFrame(
        [
            {"customer_id": 1, "tier": "tier0", "sku": "A1", "month_year": date(2026, 10, 1), "forecast_current": 70.0, "forecast_previous": None, "forecast_initial": None},
            {"customer_id": 2, "tier": "tier0", "sku": "B2", "month_year": date(2026, 10, 1), "forecast_current": 8.0, "forecast_previous": None, "forecast_initial": None},
            {"customer_id": 3, "tier": "tier0", "sku": "C3", "month_year": date(2026, 10, 1), "forecast_current": 9.0, "forecast_previous": None, "forecast_initial": None},
        ]
    )
    client = _install(monkeypatch, frame)

    lines = forecast_units.get_forecast_lines_by_customer([1, 2])


    assert sorted(lines) == [1, 2]
    assert lines[1]["current"] == {"A1": {date(2026, 10, 1): 70.0}}
    assert lines[2]["current"] == {"B2": {date(2026, 10, 1): 8.0}}


def test_a_customer_with_no_rows_still_gets_three_empty_lines(monkeypatch):
    _install(monkeypatch, pd.DataFrame(columns=LINE_COLUMNS))

    assert forecast_units.get_forecast_lines_by_customer([1]) == {
        1: {"current": {}, "previous": {}, "initial": {}}
    }
