"""The Forecast page's two small notes: the Initial Yearly Forecast status
(F7, BigQuery aire_forecasting_initial_meta) and the "Forecast updating…"
badge (F8, Cloud SQL forecast_refresh_requests). Both are best effort: a
failed read hides the note, never fails the endpoint."""

import datetime

import pandas as pd
from conftest import FakeConnection, FakeEngine
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import forecast as forecast_router
from app.services import bigquery, forecast_refresh_events, forecast_service
from app.services import forecast_refresh_worker as worker

UTC = datetime.timezone.utc


class _FakeJob:
    def __init__(self, df):
        self._df = df

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class _FakeBigQueryClient:
    def __init__(self, df):
        self.df = df
        self.queries = []

    def query(self, query, job_config=None):
        self.queries.append(query)
        return _FakeJob(self.df)


def _meta_frame(*rows):
    return pd.DataFrame(rows, columns=["forecast_year", "lock_at", "refreshed_at"])


def _client():
    app = FastAPI()
    app.include_router(forecast_router.router)
    return TestClient(app)


# ---- Initial Yearly Forecast status (F7) ----


def test_initial_meta_reads_the_configured_forecast_dataset(monkeypatch):
    fake = _FakeBigQueryClient(_meta_frame(
        (2027, pd.Timestamp("2026-12-31T15:59:00Z"), pd.Timestamp("2026-11-04T03:00:00Z")),
    ))
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)
    monkeypatch.setattr(bigquery.config, "BQ_FORECAST_DATASET", "proj.forecast_ds")

    rows = bigquery.get_initial_meta()

    assert "`proj.forecast_ds.aire_forecasting_initial_meta`" in fake.queries[0]
    assert rows == [{
        "forecast_year": 2027,
        "lock_at": "2026-12-31T15:59:00Z",
        "refreshed_at": "2026-11-04T03:00:00Z",
    }]


def test_a_year_before_its_lock_time_is_still_updating(monkeypatch):
    monkeypatch.setattr(bigquery, "get_initial_meta", lambda: [
        {"forecast_year": 2099, "lock_at": "2098-12-31T15:59:00Z", "refreshed_at": "2098-11-04T03:00:00Z"},
    ])

    status = forecast_service.get_initial_status()

    assert status["years"][0]["forecast_year"] == 2099
    assert status["years"][0]["locked"] is False


def test_a_year_past_its_lock_time_is_locked(monkeypatch):
    monkeypatch.setattr(bigquery, "get_initial_meta", lambda: [
        {"forecast_year": 2026, "lock_at": "2025-12-31T15:59:00Z", "refreshed_at": "2025-12-20T03:00:00Z"},
    ])

    assert forecast_service.get_initial_status()["years"][0]["locked"] is True


def test_a_year_with_no_meta_row_is_simply_absent(monkeypatch):
    # 2026 was backfilled outside the procedure; the page decides what to say
    # for a year that has Initial values but no row.
    monkeypatch.setattr(bigquery, "get_initial_meta", lambda: [
        {"forecast_year": 2027, "lock_at": "2026-12-31T15:59:00Z", "refreshed_at": None},
    ])

    years = forecast_service.get_initial_status()["years"]

    assert [row["forecast_year"] for row in years] == [2027]


def test_a_failed_meta_read_returns_no_years_instead_of_an_error(monkeypatch):
    def bigquery_down():
        raise RuntimeError("BigQuery unavailable")

    monkeypatch.setattr(bigquery, "get_initial_meta", bigquery_down)

    response = _client().get("/api/forecast/initial-status")

    assert response.status_code == 200
    assert response.json() == {"years": []}


# ---- Refresh status badge (F8) ----


def _status_with(monkeypatch, oldest):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    conn = FakeConnection(lambda sql, params: [(oldest,)])
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: FakeEngine(conn))
    return worker.refresh_status_best_effort(), conn


def test_a_waiting_or_running_request_means_updating(monkeypatch):
    oldest = datetime.datetime(2026, 11, 6, 2, 30, tzinfo=UTC)

    status, conn = _status_with(monkeypatch, oldest)

    assert status == {"updating": True, "since": "2026-11-06T02:30:00Z"}
    sql, _params = conn.calls[0]
    assert "status IN ('pending', 'running')" in sql
    assert "INSERT" not in sql and "UPDATE" not in sql


def test_only_finished_requests_means_not_updating(monkeypatch):
    # MIN() over no pending/running rows is NULL.
    status, _conn = _status_with(monkeypatch, None)

    assert status == {"updating": False, "since": None}


def test_a_database_error_reads_as_not_updating(monkeypatch):
    def database_down():
        raise RuntimeError("Cloud SQL unavailable")

    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", database_down)

    response = _client().get("/api/forecast/refresh-status")

    assert response.status_code == 200
    assert response.json() == {"updating": False, "since": None}


def test_with_event_refresh_off_the_badge_never_shows_and_sql_is_not_read(monkeypatch):
    def no_database_allowed():
        raise AssertionError("read the database while event refresh is off")

    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: False)
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", no_database_allowed)

    assert worker.refresh_status_best_effort() == {"updating": False, "since": None}
