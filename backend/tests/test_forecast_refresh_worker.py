from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def test_busy_forecast_leaves_request_pending_for_a_new_job(monkeypatch):
    statements = []

    class Engine:
        def begin(self):
            engine = self

            class Context:
                def __enter__(self):
                    return engine

                def __exit__(self, *_):
                    pass

            return Context()

        def execute(self, statement, parameters):
            statements.append((str(statement), parameters))

    monkeypatch.setattr(worker.sql, "connect_with_connector", lambda: Engine())
    monkeypatch.setattr(worker, "_run_outcome", lambda _: (False, False))
    monkeypatch.setattr(worker, "_retry_later", lambda: {"status": "waiting"})

    class Job:
        error_result = None

    assert worker._finish("busy-job", Job()) == {"status": "waiting"}
    assert "status = 'pending'" in statements[0][0]
    assert statements[0][1]["job_id"] == "busy-job"


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
