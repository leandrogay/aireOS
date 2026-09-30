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


def test_the_customer_id_is_a_bound_parameter(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=["sku", "month_year", "forecast_current"]))

    forecast_units.get_forecast_units(7)

    params = {p.name: p.value for p in client.last_job_config.query_parameters}
    assert params == {"customer_id": 7}
    assert "@customer_id" in client.last_query


def test_only_rows_with_a_forecast_are_read(monkeypatch):
    client = _install(monkeypatch, pd.DataFrame(columns=["sku", "month_year", "forecast_current"]))

    forecast_units.get_forecast_units(1)

    assert "forecast_current IS NOT NULL" in client.last_query


def test_predictions_are_keyed_by_sku_and_first_of_month(monkeypatch):
    frame = pd.DataFrame(
        [
            {"sku": "A1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 1310.0},
            {"sku": "A1", "month_year": date(2026, 9, 1), "forecast_current": 1984.0},
            {"sku": "B1", "month_year": pd.Timestamp("2026-08-01"), "forecast_current": 44.0},
        ]
    )
    _install(monkeypatch, frame)

    forecast = forecast_units.get_forecast_units(1)

    assert forecast == {
        "A1": {date(2026, 8, 1): 1310.0, date(2026, 9, 1): 1984.0},
        "B1": {date(2026, 8, 1): 44.0},
    }


def test_no_rows_gives_an_empty_forecast(monkeypatch):
    _install(monkeypatch, pd.DataFrame(columns=["sku", "month_year", "forecast_current"]))

    assert forecast_units.get_forecast_units(1) == {}
