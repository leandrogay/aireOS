import json

import pytest

from app.services import forecast_pipeline_events as events
from app.services import notification_service

RUN = "projects/55957091068/locations/asia-southeast1/transferConfigs/cfg/runs/run-1"
SUMMARY = {"period_start": "2026-09-01", "period_end": "2027-08-01", "customers": ["fairprice"], "skus": ["Aire Adult Pants L"]}


def _run(state, **extra):
    return {
        "name": RUN,
        "state": state,
        "startTime": "2026-10-23T02:07:00Z",
        "endTime": "2026-10-23T02:09:00Z",
        **extra,
    }


@pytest.fixture
def inserted(monkeypatch):
    rows = []
    monkeypatch.setattr(notification_service, "has_forecast_run", lambda name: False)
    monkeypatch.setattr(notification_service, "insert", lambda kind, payload: rows.append((kind, payload)) or len(rows))
    monkeypatch.setattr(events, "_latest_forecast_summary", lambda: SUMMARY)
    return rows


# ---- which runs raise a notification -------------------------------------------


def test_a_failed_run_raises_a_failure_with_its_error(inserted):
    events.handle_transfer_run(_run("FAILED", errorStatus={"message": "Data checks failed"}))

    kind, payload = inserted[0]
    assert kind == "forecast_failure"
    assert payload["errors"] == ["Data checks failed"]
    assert payload["run_name"] == RUN
    assert payload["source"] == "scheduled"
    assert payload["updated_at"] == "2026-10-23T02:09:00Z"


def test_a_failed_run_with_no_error_text_still_says_it_failed(inserted):
    events.handle_transfer_run(_run("FAILED"))

    assert inserted[0][1]["errors"] == ["The scheduled forecast run failed."]


def test_a_run_that_retrained_raises_a_success_describing_the_new_forecast(inserted, monkeypatch):
    monkeypatch.setattr(events, "_retrained_during", lambda start, end: True)

    events.handle_transfer_run(_run("SUCCEEDED"))

    kind, payload = inserted[0]
    assert kind == "forecast_success"
    assert payload == {**SUMMARY, "updated_at": "2026-10-23T02:09:00Z", "errors": [], "source": "scheduled", "run_name": RUN}


def test_a_daily_run_with_no_new_month_raises_nothing(inserted, monkeypatch):
    monkeypatch.setattr(events, "_retrained_during", lambda start, end: False)

    assert events.handle_transfer_run(_run("SUCCEEDED")) is None
    assert inserted == []


def test_a_run_already_notified_is_not_notified_again(inserted, monkeypatch):
    monkeypatch.setattr(notification_service, "has_forecast_run", lambda name: name == RUN)

    assert events.handle_transfer_run(_run("FAILED")) is None
    assert inserted == []


@pytest.mark.parametrize("state", ["RUNNING", "PENDING", "CANCELLED", None])
def test_a_run_that_has_not_succeeded_or_failed_raises_nothing(inserted, state):
    assert events.handle_transfer_run(_run(state)) is None
    assert inserted == []


# ---- the queue: acknowledge only once handled ----------------------------------------


class FakeMessage:
    def __init__(self, body):
        self.data = json.dumps(body).encode("utf-8")
        self.outcome = None

    def ack(self):
        self.outcome = "ack"

    def nack(self):
        self.outcome = "nack"


def test_a_handled_message_is_acknowledged(monkeypatch):
    monkeypatch.setattr(events, "handle_transfer_run", lambda run: None)
    message = FakeMessage(_run("SUCCEEDED"))

    events._on_message(message)

    assert message.outcome == "ack"


def test_a_message_that_could_not_be_handled_goes_back_on_the_queue(monkeypatch):
    def broken(run):
        raise RuntimeError("BigQuery unavailable")

    monkeypatch.setattr(events, "handle_transfer_run", broken)
    message = FakeMessage(_run("SUCCEEDED"))

    events._on_message(message)

    assert message.outcome == "nack"


def test_nothing_is_listened_to_without_a_subscription(monkeypatch):
    monkeypatch.setattr(events.config, "FORECAST_PIPELINE_SUBSCRIPTION", "")

    assert events.start_listening() is None


# ---- reading BigQuery ---------------------------------------------------------------


class FakeBigQuery:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def query(self, sql, job_config=None):
        self.queries.append((sql, job_config))
        rows = self.rows
        return type("Job", (), {"result": lambda self: rows})()


def test_retrained_during_reads_only_that_runs_log_rows(monkeypatch):
    fake = FakeBigQuery([{"retrained": 1}])
    monkeypatch.setattr(events, "get_bigquery_client", lambda: fake)

    assert events._retrained_during("2026-10-23T02:07:00Z", "2026-10-23T02:09:00Z") is True
    sql, job_config = fake.queries[0]
    assert "COUNTIF(retrained)" in sql
    params = {p.name: (p.type_, str(p.value)) for p in job_config.query_parameters}
    assert params == {
        "start_time": ("TIMESTAMP", "2026-10-23 02:07:00+00:00"),
        "end_time": ("TIMESTAMP", "2026-10-23 02:09:00+00:00"),
    }


def test_the_forecast_summary_names_customers_and_products(monkeypatch):
    from datetime import date

    fake = FakeBigQuery([{
        "period_start": date(2026, 9, 1),
        "period_end": date(2027, 8, 1),
        "customer_ids": [3, 1],
        "skus": ["S2", "S1"],
    }])
    monkeypatch.setattr(events, "get_bigquery_client", lambda: fake)
    monkeypatch.setattr(events.inventory_service, "list_customers", lambda: [
        {"customer_id": 1, "customer_name": "fairprice"}, {"customer_id": 3, "customer_name": "nhg"},
    ])
    monkeypatch.setattr(events.catalog_service, "get_skus", lambda: [
        {"sku": "S1", "product_name": "Pants L"}, {"sku": "S2", "product_name": "Tape XL"},
    ])

    assert events._latest_forecast_summary() == {
        "period_start": "2026-09-01",
        "period_end": "2027-08-01",
        "customers": ["fairprice", "nhg"],
        "skus": ["Pants L", "Tape XL"],
    }
