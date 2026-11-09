from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from conftest import FakeConnection, FakeEngine
from google.api_core.exceptions import NotFound

from app.routers import internal_forecast
from app.services import forecast_refresh_events, forecast_refresh_worker as worker


class _ReadEngine:
    def __init__(self):
        self.connection = object()

    def connect(self):
        engine = self

        class Context:
            def __enter__(self):
                return engine.connection

            def __exit__(self, *_):
                pass

        return Context()


def test_sales_signature_matches_sql_and_bigquery_numeric_types():
    sql_row = {
        "retailer_id": 55, "sku": "13255043", "store_code": "4",
        "period_start": datetime(2026, 1, 1).date(),
        "period_end": datetime(2026, 1, 7).date(),
        "period_type": "week", "quantity_units": 12.0,
        "revenue": 24.125, "source_file": "weekly.txt",
        "loaded_at": datetime(2026, 11, 4, 5, tzinfo=timezone.utc),
    }
    copied = {**sql_row, "quantity_units": Decimal("12"), "revenue": Decimal("24.125000")}
    assert worker._signature([sql_row], worker.SALES_COLUMNS) == worker._signature(
        [copied], worker.SALES_COLUMNS
    )
    copied["revenue"] = Decimal("24.13")
    assert worker._signature([sql_row], worker.SALES_COLUMNS) != worker._signature(
        [copied], worker.SALES_COLUMNS
    )


def test_worker_waits_when_cdc_has_not_landed(monkeypatch):
    engine = _ReadEngine()
    pending = [{
        "id": 10, "kind": "sales_upload", "source": "sales:weekly.txt",
        "created_at": datetime.now(timezone.utc) - timedelta(minutes=10),
    }]
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: engine)
    monkeypatch.setattr(worker, "_running", lambda _: None)
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_inputs_landed", lambda *_: False)
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})
    monkeypatch.setattr(worker, "_claim", lambda *_: (_ for _ in ()).throw(AssertionError("claimed too early")))

    assert worker.check_refresh() == {"status": "waiting"}


def test_expired_cdc_wait_fails_batch_and_notifies(monkeypatch):
    pending = [{
        "id": 10, "kind": "sales_upload", "source": "sales:weekly.txt",
        "created_at": datetime.now(timezone.utc) - timedelta(hours=3),
    }]
    conn = FakeConnection(lambda sql, params: [(10,)] if "UPDATE forecast_refresh_requests" in sql else [])
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker, "_running", lambda _: None)
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_inputs_landed", lambda *_: False)
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "2h")
    monkeypatch.setattr(worker.notification_service, "has_forecast_run", lambda _: False)
    notifications = []
    monkeypatch.setattr(worker.notification_service, "insert_best_effort", lambda kind, payload: notifications.append((kind, payload)))

    assert worker.check_refresh()["status"] == "failed"
    assert conn.sql_containing("UPDATE forecast_refresh_requests")[0][1]["ids"] == [10]
    assert notifications[0][0] == "forecast_failure"
    assert notifications[0][1]["stage"] == "refresh"
    assert notifications[0][1]["run_name"] == "refresh-10"


def test_old_request_does_not_expire_batch_with_recent_save(monkeypatch):
    now = datetime.now(timezone.utc)
    pending = [
        {"id": 10, "created_at": now - timedelta(hours=3)},
        {"id": 11, "created_at": now - timedelta(minutes=10)},
    ]
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", _ReadEngine)
    monkeypatch.setattr(worker, "_running", lambda _: None)
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_inputs_landed", lambda *_: False)
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})
    monkeypatch.setattr(worker, "_fail_pending", lambda *_: (_ for _ in ()).throw(AssertionError("failed recent save")))
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "2h")

    assert worker.check_refresh() == {"status": "waiting"}


def test_old_request_does_not_fail_new_save_during_quiet_period(monkeypatch):
    now = datetime.now(timezone.utc)
    pending = [
        {"id": 10, "created_at": now - timedelta(hours=3)},
        {"id": 11, "created_at": now - timedelta(minutes=1)},
    ]
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", _ReadEngine)
    monkeypatch.setattr(worker, "_running", lambda _: None)
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_inputs_landed", lambda *_: (_ for _ in ()).throw(AssertionError("checked CDC during quiet period")))
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})
    monkeypatch.setattr(worker, "_fail_pending", lambda *_: (_ for _ in ()).throw(AssertionError("failed recent save")))
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "2h")

    assert worker.check_refresh() == {"status": "waiting"}


def test_landed_data_starts_even_after_wait_limit(monkeypatch):
    pending = [{
        "id": 10, "created_at": datetime.now(timezone.utc) - timedelta(hours=3),
    }]
    claimed = []
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", _ReadEngine)
    monkeypatch.setattr(worker, "_running", lambda _: None)
    monkeypatch.setattr(worker, "_pending", lambda _: pending)
    monkeypatch.setattr(worker, "_inputs_landed", lambda *_: True)
    monkeypatch.setattr(worker, "_max_wait", lambda: (_ for _ in ()).throw(AssertionError("checked limit after landing")))
    monkeypatch.setattr(worker, "_claim", lambda ids, job_id: claimed.append(ids) or True)
    monkeypatch.setattr(worker, "_ensure_job", lambda _: type("Job", (), {"done": lambda self: False})())
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})

    assert worker.check_refresh() == {"status": "waiting"}
    assert claimed == [[10]]


def test_sku_cdc_check_waits_for_archived_state(monkeypatch):
    conn = FakeConnection(lambda sql, params: [{"sku": "A1", "is_active": False}])
    monkeypatch.setattr(worker, "_query_bigquery", lambda *_: [{"sku": "A1", "is_active": True}])
    assert worker._skus_landed(conn, ["A1"]) is False


def test_forecast_page_recovery_queues_stale_request(monkeypatch):
    conn = FakeConnection(lambda sql, params: [(True,)])
    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: FakeEngine(conn))
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    queued = []
    monkeypatch.setattr(forecast_refresh_events, "enqueue_check", lambda **kwargs: queued.append(kwargs))

    worker.recover_best_effort()

    assert queued[0]["delay_seconds"] == 0
    assert queued[0]["key"].startswith("forecast-recovery-")


def test_running_job_blocks_a_second_batch(monkeypatch):
    engine = _ReadEngine()

    class Job:
        def done(self):
            return False

    monkeypatch.setattr(worker.sql, "connect_with_connector_autocommit", lambda: engine)
    monkeypatch.setattr(worker, "_running", lambda _: "existing-job")
    monkeypatch.setattr(worker, "_ensure_job", lambda job_id: Job() if job_id == "existing-job" else None)
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})
    monkeypatch.setattr(worker, "_pending", lambda _: (_ for _ in ()).throw(AssertionError("read pending while running")))

    assert worker.check_refresh() == {"status": "waiting"}


def test_outbox_is_inert_until_enabled(monkeypatch):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: False)
    assert forecast_refresh_events.record_change(object(), "sales_upload", "sales:weekly.txt") is None


def test_batch_job_id_is_stable():
    assert worker._job_id([1, 2, 3]) == worker._job_id([1, 2, 3])
    assert worker._job_id([1, 2, 3]) != worker._job_id([1, 2, 4])
    first = worker._job_id([1, 2, 3])
    assert worker._job_id([1, 2, 3], first) == first + "_retry1"
    assert worker._job_id([1, 2, 3], first + "_retry1") == first + "_retry2"
    assert worker._job_id([1, 2, 4], first) == worker._job_id([1, 2, 4])


def test_event_job_targets_singapore_procedure_with_label(monkeypatch):
    calls = []

    class Client:
        def get_job(self, *_args, **_kwargs):
            raise NotFound("job does not exist")

        def query(self, query, **kwargs):
            calls.append((query, kwargs))
            return object()

    monkeypatch.setattr(worker, "get_bigquery_client", lambda: Client())
    monkeypatch.setattr(worker.config, "BQ_FORECAST_DATASET", "aire-data.aireos_forecast_validation_sg")
    monkeypatch.setattr(worker.config, "BQ_FORECAST_LOCATION", "asia-southeast1")

    worker._ensure_job("event-1")

    query, options = calls[0]
    assert query == "CALL `aire-data.aireos_forecast_validation_sg.retrain_if_new_month`(TRUE)"
    assert options["location"] == "asia-southeast1"
    assert options["job_config"].labels == {"trigger": "fc_event"}


def _busy_finish(monkeypatch, waited: timedelta):
    """Run _finish for a job the procedure skipped as busy; returns (result, conn, failures)."""
    created_at = datetime.now(timezone.utc) - waited
    conn = FakeConnection(
        lambda sql, params: [{"id": 7, "created_at": created_at}] if "RETURNING id, created_at" in sql else []
    )
    failures = []
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker, "_run_outcome", lambda _: (False, False))
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})
    monkeypatch.setattr(worker, "_fail_pending", lambda requests, reason: failures.append((requests, reason)) or {"status": "failed"})
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "2h")

    class Job:
        error_result = None

    return worker._finish("busy-job", Job()), conn, failures


def test_busy_forecast_leaves_request_pending_for_a_new_job(monkeypatch):
    result, conn, failures = _busy_finish(monkeypatch, timedelta(minutes=20))

    assert result == {"status": "waiting"}
    sql, params = conn.sql_containing("status = 'pending'")[0]
    assert params["job_id"] == "busy-job"
    assert failures == []


def test_busy_forecast_past_the_wait_limit_stops_retrying_and_fails(monkeypatch):
    result, _conn, failures = _busy_finish(monkeypatch, timedelta(hours=3))

    assert result == {"status": "failed"}
    requests, reason = failures[0]
    assert [row["id"] for row in requests] == [7]
    assert reason == "Another forecast run was still in progress after 2 hours"


def test_busy_failure_reason_follows_the_wait_setting(monkeypatch):
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "30m")
    assert worker._max_wait_text() == "30 minutes"
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "1h")
    assert worker._max_wait_text() == "1 hour"


def test_busy_failure_writes_the_couldnt_start_notification(monkeypatch):
    created_at = datetime.now(timezone.utc) - timedelta(hours=3)
    conn = FakeConnection(
        lambda sql, params: [{"id": 7, "created_at": created_at}] if "RETURNING id, created_at" in sql
        else [(7,)] if "status = 'failed'" in sql else []
    )
    notifications = []
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(conn))
    monkeypatch.setattr(worker, "_run_outcome", lambda _: (False, False))
    monkeypatch.setattr(worker.config, "FORECAST_REFRESH_MAX_WAIT", "2h")
    monkeypatch.setattr(
        worker.forecast_notifications, "notify_once", lambda kind, payload: notifications.append((kind, payload))
    )

    class Job:
        error_result = None

    assert worker._finish("busy-job", Job())["status"] == "failed"
    kind, payload = notifications[0]
    assert kind == "forecast_failure"
    assert payload["stage"] == "refresh"
    assert payload["source"] == "event"
    assert payload["run_name"] == "refresh-7"
    assert payload["reason"] == "Another forecast run was still in progress after 2 hours"


def test_task_uses_delayed_oidc_request(monkeypatch):
    sent = []

    class Client:
        def queue_path(self, project, location, queue):
            return f"projects/{project}/locations/{location}/queues/{queue}"

        def create_task(self, *, request):
            sent.append(request)

    monkeypatch.setattr(forecast_refresh_events, "_tasks_client", lambda: Client())
    monkeypatch.setattr(forecast_refresh_events.config, "GCP_PROJECT_ID", "aire-data")
    monkeypatch.setattr(forecast_refresh_events.config, "FORECAST_REFRESH_HANDLER_URL", "https://api.example/internal/forecast/refresh-check")
    monkeypatch.setattr(forecast_refresh_events.config, "FORECAST_REFRESH_INVOKER", "task@example.iam.gserviceaccount.com")

    forecast_refresh_events.enqueue_check(key="forecast-change-42", delay_seconds=300)

    task = sent[0]["task"]
    assert task["name"].endswith("/tasks/forecast-change-42")
    assert task["http_request"]["oidc_token"] == {
        "service_account_email": "task@example.iam.gserviceaccount.com",
        "audience": "https://api.example",
    }
    assert task["http_request"]["url"].endswith("/internal/forecast/refresh-check")


def test_internal_callback_rejects_browser_and_forged_tokens(monkeypatch):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    monkeypatch.setattr(forecast_refresh_events, "handler_audience", lambda: "https://api.example")
    app = FastAPI()
    app.include_router(internal_forecast.router)
    client = TestClient(app)

    assert client.post("/internal/forecast/refresh-check").status_code == 401
    assert client.post(
        "/internal/forecast/refresh-check", headers={"Authorization": "Bearer forged"}
    ).status_code == 401


def test_internal_callback_runs_only_for_the_task_identity(monkeypatch):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    monkeypatch.setattr(forecast_refresh_events, "handler_audience", lambda: "https://api.example")
    monkeypatch.setattr(internal_forecast.config, "FORECAST_REFRESH_INVOKER", "task@example.iam.gserviceaccount.com")
    monkeypatch.setattr(
        internal_forecast.id_token, "verify_oauth2_token",
        lambda *_: {"email": "task@example.iam.gserviceaccount.com", "email_verified": True},
    )
    monkeypatch.setattr(worker, "check_refresh", lambda: {"status": "idle"})
    app = FastAPI()
    app.include_router(internal_forecast.router)
    response = TestClient(app).post(
        "/internal/forecast/refresh-check", headers={"Authorization": "Bearer valid"}
    )
    assert response.status_code == 200
    assert response.json() == {"status": "idle"}


def test_last_cloud_task_attempt_records_refresh_failure(monkeypatch):
    monkeypatch.setattr(forecast_refresh_events, "enabled", lambda: True)
    monkeypatch.setattr(internal_forecast, "_verify_task", lambda _: None)
    monkeypatch.setattr(worker, "check_refresh", lambda: (_ for _ in ()).throw(RuntimeError("CDC unavailable")))
    failures = []
    monkeypatch.setattr(worker, "fail_unstarted_best_effort", failures.append)
    app = FastAPI()
    app.include_router(internal_forecast.router)

    response = TestClient(app).post(
        "/internal/forecast/refresh-check",
        headers={"X-CloudTasks-TaskRetryCount": "9"},
    )

    assert response.status_code == 503
    assert len(failures) == 1
    assert "CDC unavailable" in failures[0]


# ---- sell-in plan snapshot -----------------------------------------------------


def _finished(monkeypatch, *, failed: bool, retrained: bool) -> list:
    """Run _finish for a job that ran; returns the snapshots taken."""
    taken = []
    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: FakeEngine(FakeConnection()))
    monkeypatch.setattr(worker, "_run_outcome", lambda _: (True, retrained))
    monkeypatch.setattr(worker, "_notify_outcome", lambda *_: None)
    monkeypatch.setattr(worker, "_pending", lambda _: [])
    monkeypatch.setattr(worker.sell_in_snapshots, "take_snapshot_best_effort", lambda: taken.append(True))

    class Job:
        error_result = {"message": "boom"} if failed else None

    worker._finish("job-1", Job())
    return taken


def test_a_refresh_that_retrained_saves_the_sell_in_plan(monkeypatch):
    assert _finished(monkeypatch, failed=False, retrained=True) == [True]


def test_a_refresh_with_no_new_month_saves_no_sell_in_plan(monkeypatch):
    assert _finished(monkeypatch, failed=False, retrained=False) == []


def test_a_failed_refresh_saves_no_sell_in_plan(monkeypatch):
    assert _finished(monkeypatch, failed=True, retrained=False) == []


# ---- Success notification summary ----


class _SummaryBigQuery:
    def __init__(self, rows):
        self.rows = rows

    def query(self, sql, job_config=None):
        rows = self.rows
        return type("Job", (), {"result": lambda self: rows})()


def test_the_forecast_summary_names_customers_and_products(monkeypatch):
    fake = _SummaryBigQuery([{
        "period_start": datetime(2026, 9, 1).date(),
        "period_end": datetime(2027, 8, 1).date(),
        "customer_ids": [3, 1],
        "skus": ["S2", "S1"],
    }])
    monkeypatch.setattr(worker, "get_bigquery_client", lambda: fake)
    monkeypatch.setattr(worker.inventory_service, "list_customers", lambda: [
        {"customer_id": 1, "customer_name": "fairprice"}, {"customer_id": 3, "customer_name": "nhg"},
    ])
    monkeypatch.setattr(worker.catalog_service, "get_skus", lambda: [
        {"sku": "S1", "product_name": "Pants L"}, {"sku": "S2", "product_name": "Tape XL"},
    ])

    assert worker.latest_forecast_summary() == {
        "period_start": "2026-09-01",
        "period_end": "2027-08-01",
        "customers": ["fairprice", "nhg"],
        "skus": ["Pants L", "Tape XL"],
    }


def test_a_forecast_with_no_current_run_has_an_empty_summary(monkeypatch):
    monkeypatch.setattr(worker, "get_bigquery_client", lambda: _SummaryBigQuery([{"period_start": None}]))

    assert worker.latest_forecast_summary() == {"period_start": None, "period_end": None, "customers": [], "skus": []}
