from datetime import date

import pandas as pd

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

    def result(self):
        return self

    def to_dataframe(self):
        return self._frame


def _install(monkeypatch, frame):
    client = FakeBigQueryClient(frame)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)
    return client


COLUMNS = ["customer_id", "sku", "month_year", "forecast_current"]


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
            {"customer_id": 1, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 2, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 20.0},
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
            {"customer_id": 1, "sku": "A1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 1310.0},
            {"customer_id": 1, "sku": "A1", "month_year": date(2026, 9, 1), "forecast_current": 1984.0},
            {"customer_id": 1, "sku": "B1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 44.0},
        ]
    )
    _install(monkeypatch, frame)

    forecast = forecast_units.get_forecast_units(1)

    assert forecast == {
        "A1": {date(2026, 8, 1): 1310.0, date(2026, 9, 1): 1984.0},
        "B1": {date(2026, 8, 1): 44.0},
    }


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
            {"customer_id": 1, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 2, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 20.0},
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
            {"customer_id": 1, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 10.0},
            {"customer_id": 3, "sku": "A1", "month_year": date(2026, 8, 1), "forecast_current": 30.0},
        ]
    )
    _install(monkeypatch, frame)

    assert set(forecast_units.get_forecast_units_by_customer([1, 2])) == {1}


def test_no_customers_skips_bigquery(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery must not be called")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)

    assert forecast_units.get_forecast_units_by_customer([]) == {}
