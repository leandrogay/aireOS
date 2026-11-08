"""
Forecast notification outcomes (handover K4): which bell notification each
refresh outcome writes, in the one payload shape of forecast_notifications.

No GCP and no database: BigQuery jobs are tiny fake classes, Cloud SQL is
conftest's FakeEngine, and notification_service's reads/writes are replaced
with recorders. The time-limit path is covered in test_forecast_refresh_worker.
"""

from datetime import datetime, timezone

import pytest
from conftest import FakeConnection, FakeEngine
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import internal_forecast
from app.services import forecast_notifications, forecast_refresh_events, notification_service
from app.services import forecast_refresh_worker as worker

SUMMARY = {
    "period_start": "2026-11-01",
    "period_end": "2027-10-01",
    "customers": ["fairprice"],
    "skus": ["Aire Adult Pants L"],
}
ENDED = datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc)
CONTRACT_KEYS = {
    "run_name", "source", "stage", "reason", "errors",
    "period_start", "period_end", "customers", "skus", "updated_at", "warnings",
}
INITIAL_ERROR = "Initial refresh failed: Not enough history to train initial_arimax_model at [12:5]"


class FakeJob:
    """The parts of a finished google.cloud.bigquery QueryJob _finish reads."""

    def __init__(self, error_result=None, errors=None):
        self.error_result = error_result
        self.errors = errors
        self.started = datetime(2026, 11, 5, 2, 50, tzinfo=timezone.utc)
        self.ended = ENDED


@pytest.fixture
def written(monkeypatch):
    """Records every notification written; none exist beforehand."""
    rows = []
    monkeypatch.setattr(notification_service, "has_forecast_run", lambda run_name: False)
    monkeypatch.setattr(
        notification_service, "insert",
        lambda kind, payload, **_: rows.append((kind, payload)) or len(rows),
    )
    return rows


@pytest.fixture
def batch(monkeypatch):
    """A Cloud SQL fake for the batch status update, with nothing else pending."""
    conn = FakeConnection()
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker, "_pending", lambda _: [])
    monkeypatch.setattr(worker, "latest_forecast_summary", lambda: SUMMARY)
    # A retrain saves the sell-in plans (sell_in_snapshots), which reads BigQuery.
    monkeypatch.setattr(worker.sell_in_snapshots, "take_snapshot_best_effort", lambda: None)
    return conn


def _status_update(conn):
    return conn.sql_containing("SET status = :status")[0][1]


# ---- Payload builders ----


def test_success_payload_has_every_contract_field():
    payload = forecast_notifications.success_payload(
        run_name="job-1", source="event", updated_at=ENDED, summary=SUMMARY,
    )

    assert set(payload) == CONTRACT_KEYS
    assert payload["stage"] == "pipeline"
    assert payload["reason"] is None
    assert payload["errors"] == []
    assert payload["customers"] == ["fairprice"]
    assert payload["updated_at"] == "2026-11-05T03:00:00+00:00"


def test_refresh_failure_payload_has_every_contract_field_and_no_forecast():
    payload = forecast_notifications.failure_payload(
        run_name="refresh-10", source="event", updated_at=ENDED,
        stage="refresh", reason="Sales data did not reach BigQuery within 2 hours",
    )

    assert set(payload) == CONTRACT_KEYS
    assert payload["stage"] == "refresh"
    assert payload["reason"] == "Sales data did not reach BigQuery within 2 hours"
    assert payload["period_start"] is None
    assert payload["customers"] == []
    assert payload["skus"] == []


@pytest.mark.parametrize("source, stage", [("cron", "pipeline"), ("event", "started")])
def test_unknown_source_or_stage_is_rejected(source, stage):
    with pytest.raises(ValueError):
        forecast_notifications.failure_payload(
            run_name="x", source=source, updated_at=ENDED, stage=stage, reason="r",
        )


def test_job_failure_reason_is_the_headline_and_errors_list_every_message():
    job = FakeJob(
        error_result={"reason": "invalidQuery", "message": "Data check failed: negative quantity"},
        errors=[
            {"reason": "invalidQuery", "message": "Data check failed: negative quantity"},
            {"reason": "invalid", "message": "SKU 123 has a partial month"},
        ],
    )

    reason, errors = forecast_notifications.job_failure(job)

    assert reason == "Data check failed: negative quantity"
    assert errors == ["Data check failed: negative quantity", "SKU 123 has a partial month"]


def test_job_failure_without_a_message_still_says_it_failed():
    reason, errors = forecast_notifications.job_failure(FakeJob(error_result={"reason": "internalError"}))

    assert reason == forecast_notifications.DEFAULT_JOB_FAILURE_REASON
    assert errors == ["{'reason': 'internalError'}"]


# ---- Best-effort writes ----


def test_notify_once_skips_a_run_already_notified(written, monkeypatch):
    monkeypatch.setattr(notification_service, "has_forecast_run", lambda run_name: run_name == "job-1")

    result = forecast_notifications.notify_once("forecast_success", {"run_name": "job-1"})

    assert result is None
    assert written == []


def test_notify_once_never_raises_when_the_duplicate_check_fails(written, monkeypatch):
    def database_down(_run_name):
        raise RuntimeError("Cloud SQL unavailable")

    monkeypatch.setattr(notification_service, "has_forecast_run", database_down)

    assert forecast_notifications.notify_once("forecast_success", {"run_name": "job-1"}) is None
    assert written == []


def test_notify_once_never_raises_when_the_write_fails(monkeypatch):
    def rejected(*_args, **_kwargs):
        raise RuntimeError("check constraint violated")

    monkeypatch.setattr(notification_service, "has_forecast_run", lambda _: False)
    monkeypatch.setattr(notification_service, "insert", rejected)

    assert forecast_notifications.notify_once("forecast_failure", {"run_name": "job-1"}) is None


# ---- _finish: one BigQuery job's outcome ----


def test_job_error_writes_a_pipeline_failure(written, batch):
    job = FakeJob(error_result={"message": "Data check failed: negative quantity"})

    assert worker._finish("job-1", job)["status"] == "failed"

    kind, payload = written[0]
    assert kind == "forecast_failure"
    assert set(payload) == CONTRACT_KEYS
    assert payload["stage"] == "pipeline"
    assert payload["source"] == "event"
    assert payload["run_name"] == "job-1"
    assert payload["reason"] == "Data check failed: negative quantity"
    assert payload["errors"] == ["Data check failed: negative quantity"]
    assert _status_update(batch)["status"] == "failed"


def test_retrained_job_writes_a_success_describing_the_forecast(written, batch, monkeypatch):
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, True))

    assert worker._finish("job-1", FakeJob())["status"] == "completed"

    kind, payload = written[0]
    assert kind == "forecast_success"
    assert payload == forecast_notifications.success_payload(
        run_name="job-1", source="event", updated_at=ENDED, summary=SUMMARY,
    )
    assert _status_update(batch)["status"] == "completed"


def test_job_that_found_nothing_to_retrain_writes_nothing(written, batch, monkeypatch):
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, False))

    assert worker._finish("job-1", FakeJob())["status"] == "completed"

    assert written == []
    assert _status_update(batch)["status"] == "completed"


def test_busy_forecast_writes_nothing_and_requeues(written, batch, monkeypatch):
    # retrain_if_new_month logs no row when another retrain holds its lock.
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (False, False))
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})

    assert worker._finish("job-1", FakeJob()) == {"status": "waiting"}

    assert written == []
    assert batch.sql_containing("status = 'pending'")
    assert not batch.sql_containing("SET status = :status")


def test_a_retried_task_does_not_notify_the_same_job_twice(written, batch, monkeypatch):
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, True))
    monkeypatch.setattr(notification_service, "has_forecast_run", lambda run_name: run_name == "job-1")

    worker._finish("job-1", FakeJob())

    assert written == []


def test_batch_still_finishes_when_the_notification_cannot_be_written(batch, monkeypatch):
    def rejected(*_args, **_kwargs):
        raise RuntimeError("Cloud SQL unavailable")

    monkeypatch.setattr(notification_service, "has_forecast_run", lambda _: False)
    monkeypatch.setattr(notification_service, "insert", rejected)
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, True))

    assert worker._finish("job-1", FakeJob())["status"] == "completed"
    assert _status_update(batch)["status"] == "completed"


def test_success_is_still_notified_when_the_summary_query_fails(written, batch, monkeypatch):
    def bigquery_down():
        raise RuntimeError("BigQuery unavailable")

    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, True))
    monkeypatch.setattr(worker, "latest_forecast_summary", bigquery_down)

    worker._finish("job-1", FakeJob())

    kind, payload = written[0]
    assert kind == "forecast_success"
    assert payload["period_start"] is None
    assert payload["customers"] == []


# ---- Last Cloud Tasks attempt ----


def _post_failing_check(monkeypatch, retry_count: str):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    monkeypatch.setattr(internal_forecast, "_verify_task", lambda _: None)
    monkeypatch.setattr(worker, "check_refresh", lambda: (_ for _ in ()).throw(RuntimeError("CDC unavailable")))
    app = FastAPI()
    app.include_router(internal_forecast.router)
    return TestClient(app).post(
        "/internal/forecast/refresh-check",
        headers={"X-CloudTasks-TaskRetryCount": retry_count},
    )


def test_an_earlier_attempt_leaves_the_retry_to_cloud_tasks(monkeypatch):
    recorded = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", recorded.append)

    response = _post_failing_check(monkeypatch, "3")

    assert response.status_code == 503
    assert recorded == []


def test_retry_eight_of_ten_attempts_is_not_the_last(monkeypatch):
    recorded = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", recorded.append)
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_MAX_ATTEMPTS", "10")

    response = _post_failing_check(monkeypatch, "8")

    assert response.status_code == 503
    assert recorded == []


def test_retry_nine_of_ten_attempts_is_the_last(monkeypatch):
    recorded = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", recorded.append)
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_MAX_ATTEMPTS", "10")

    response = _post_failing_check(monkeypatch, "9")

    assert response.status_code == 503
    assert len(recorded) == 1


def test_a_custom_max_attempts_moves_the_last_attempt(monkeypatch):
    recorded = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", recorded.append)
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_MAX_ATTEMPTS", "5")

    _post_failing_check(monkeypatch, "3")
    assert recorded == []
    _post_failing_check(monkeypatch, "4")
    assert len(recorded) == 1


def test_an_unreadable_max_attempts_falls_back_to_ten(monkeypatch):
    recorded = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", recorded.append)
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_MAX_ATTEMPTS", "ten")

    _post_failing_check(monkeypatch, "8")
    assert recorded == []
    _post_failing_check(monkeypatch, "9")
    assert len(recorded) == 1


def test_last_attempt_writes_a_refresh_failure_for_the_waiting_requests(written, monkeypatch):
    pending = [{"id": 7, "kind": "promotion_change", "source": "promotion:3", "created_at": ENDED, "job_id": None}]
    conn = FakeConnection(lambda sql, params: [(7,)] if "UPDATE forecast_refresh_requests" in sql else [])
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_running", lambda _: None)

    response = _post_failing_check(monkeypatch, "9")

    assert response.status_code == 503
    kind, payload = written[0]
    assert kind == "forecast_failure"
    assert payload["stage"] == "refresh"
    assert payload["run_name"] == "refresh-7"
    assert "CDC unavailable" in payload["reason"]


def test_last_attempt_never_hides_the_error_when_the_database_is_down(written, monkeypatch):
    def database_down():
        raise RuntimeError("Cloud SQL unavailable")

    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", database_down)

    response = _post_failing_check(monkeypatch, "9")

    assert response.status_code == 503
    assert "CDC unavailable" in response.json()["detail"]
    assert written == []


# ---- _finish: the Initial refresh failed after the retrain ----


def test_initial_refresh_warning_reads_only_a9_1s_held_initial_error():
    warning = forecast_notifications.initial_refresh_warning(FakeJob(error_result={"message": INITIAL_ERROR}))

    assert warning.startswith(forecast_notifications.INITIAL_WARNING)
    assert "Not enough history to train initial_arimax_model" in warning
    assert forecast_notifications.initial_refresh_warning(
        FakeJob(error_result={"message": "Data check failed: negative quantity"})
    ) is None


def test_initial_error_after_a_retrain_is_a_success_with_a_warning(written, batch, monkeypatch):
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, True))

    assert worker._finish("job-1", FakeJob(error_result={"message": INITIAL_ERROR}))["status"] == "completed"

    kind, payload = written[0]
    assert kind == "forecast_success"
    assert set(payload) == CONTRACT_KEYS
    assert payload["customers"] == ["fairprice"]
    assert len(payload["warnings"]) == 1
    assert "initial_arimax_model" in payload["warnings"][0]
    update = _status_update(batch)
    assert update["status"] == "completed"
    assert "Initial refresh failed" in update["error"]


def test_initial_error_with_no_retrain_is_still_a_failure(written, batch, monkeypatch):
    monkeypatch.setattr(worker, "_run_outcome", lambda _job: (True, False))

    assert worker._finish("job-1", FakeJob(error_result={"message": INITIAL_ERROR}))["status"] == "failed"

    kind, payload = written[0]
    assert kind == "forecast_failure"
    assert payload["reason"] == INITIAL_ERROR
    assert payload["warnings"] == []
    assert _status_update(batch)["status"] == "failed"
