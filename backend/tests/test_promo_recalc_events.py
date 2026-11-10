import pytest
from conftest import FakeConnection

from app.services.settings import promo_recalc_events as events


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(events.config, "PROMO_RECALC_ENABLED", "true")


# ---- recording -----------------------------------------------------------------------


def test_nothing_is_recorded_while_disabled_so_saves_never_need_migration_020():
    conn = FakeConnection()

    assert events.record_customers(conn, "anchor_change", [1]) is False
    assert events.record_promotion(conn, 5) is False
    assert events.record_retailers(conn, "sales_upload", [11]) is False
    assert conn.calls == []


def test_recalculate_records_even_while_disabled():
    conn = FakeConnection()

    assert events.record_customers(conn, "manual", [1], force=True) is True
    (_, params), = conn.sql_containing("INSERT INTO promo_recalc_requests")
    assert params == {"customer_id": 1, "reason": "manual", "source": None}


def test_every_customer_is_one_request_with_no_customer(enabled):
    conn = FakeConnection()

    events.record_customers(conn, "mechanic_change", None, "promo_uplift_settings")

    assert [params["customer_id"] for _, params in conn.sql_containing("INSERT INTO promo_recalc_requests")] == [None]


def test_a_promotion_queues_the_customers_its_stores_belong_to(enabled):
    conn = FakeConnection()

    events.record_promotion(conn, 5)

    (sql, params), = conn.sql_containing("INSERT INTO promo_recalc_requests")
    assert "FROM promotion_stores pst" in sql and "customer_retailers cr" in sql
    assert params == {"promotion_id": 5}


def test_a_sales_load_queues_the_customers_of_its_retailers_once_each(enabled):
    conn = FakeConnection()

    events.record_retailers(conn, "sales_upload", [12, 11, 12], "sales:file.xlsx")

    (_, params), = conn.sql_containing("INSERT INTO promo_recalc_requests")
    assert params["retailer_ids"] == [11, 12]


def test_an_unknown_reason_is_refused():
    with pytest.raises(ValueError):
        events.record_customers(FakeConnection(), "because", [1], force=True)


# ---- waking the worker -------------------------------------------------------------


def test_saves_in_the_same_window_share_one_task(monkeypatch):
    sent = []
    monkeypatch.setattr(events.config, "PROMO_RECALC_HANDLER_URL", "https://api.example/internal/promo/recalc")
    monkeypatch.setattr(events.forecast_refresh_events, "enqueue_check", lambda **kwargs: sent.append(kwargs))
    monkeypatch.setattr(events.time, "time", lambda: 3 * events.QUIET_SECONDS + 10)

    events.enqueue_best_effort(True)
    events.enqueue_best_effort(True)

    assert [task["key"] for task in sent] == ["promo-recalc-3", "promo-recalc-3"]
    assert sent[0]["url"] == "https://api.example/internal/promo/recalc"
    assert sent[0]["delay_seconds"] == events.QUIET_SECONDS


def test_no_task_without_a_handler_url_or_a_recorded_request(monkeypatch):
    sent = []
    monkeypatch.setattr(events.forecast_refresh_events, "enqueue_check", lambda **kwargs: sent.append(kwargs))

    monkeypatch.setattr(events.config, "PROMO_RECALC_HANDLER_URL", "")
    events.enqueue_best_effort(True)
    monkeypatch.setattr(events.config, "PROMO_RECALC_HANDLER_URL", "https://api.example/internal/promo/recalc")
    events.enqueue_best_effort(False)

    assert sent == []


def test_a_task_that_cannot_be_created_does_not_fail_the_save(monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("Cloud Tasks down")

    monkeypatch.setattr(events.config, "PROMO_RECALC_HANDLER_URL", "https://api.example/internal/promo/recalc")
    monkeypatch.setattr(events.forecast_refresh_events, "enqueue_check", broken)

    events.enqueue_best_effort(True)
