from datetime import datetime, timezone

from conftest import FakeConnection, FakeEngine

from app.services import notification_service


def _router(rows=None, affected=1):
    """respond() that answers by the statement each call sends."""

    def respond(sql, params):
        if "INSERT INTO notifications" in sql:
            return [(99,)]
        if "UPDATE notifications" in sql:
            return [(1,)] * affected
        if "SELECT COUNT(*)" in sql:
            return [(len(rows or []),)]
        if "unnest(skus)" in sql:
            return [(sku,) for sku in (rows or [])]
        if "FROM notifications" in sql:
            return rows or []
        return []

    return respond


def _install(monkeypatch, respond):
    conn = FakeConnection(respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(notification_service, "_get_engine", lambda: engine)
    monkeypatch.setattr(notification_service, "_get_read_engine", lambda: engine)
    return conn


STAMP = datetime(2026, 10, 15, 9, 0, tzinfo=timezone.utc)


def _row(payload, read_at=None):
    return (1, notification_service.LOW_STOCK, payload, STAMP, read_at)


def test_list_notifications_reads_newest_first_query(monkeypatch):
    conn = _install(monkeypatch, _router(rows=[_row({"sku": "A1"})]))

    result = notification_service.list_notifications()

    assert result == [
        {
            "notification_id": 1,
            "notification_type": "low_stock",
            "payload": {"sku": "A1"},
            "created_at": STAMP.isoformat(),
            "read_at": None,
        }
    ]
    sql, _ = conn.calls[0]
    assert "ORDER BY created_at DESC" in sql


def test_list_notifications_unread_only_adds_the_filter(monkeypatch):
    conn = _install(monkeypatch, _router(rows=[]))

    notification_service.list_notifications(unread_only=True)

    sql, _ = conn.calls[0]
    assert "WHERE read_at IS NULL" in sql


def test_a_payload_stored_as_a_json_string_is_still_decoded(monkeypatch):
    _install(monkeypatch, _router(rows=[_row('{"sku": "A1"}')]))

    result = notification_service.list_notifications()

    assert result[0]["payload"] == {"sku": "A1"}


def test_unread_count_counts_only_unread_rows(monkeypatch):
    _install(monkeypatch, _router(rows=["a", "b", "c"]))

    assert notification_service.unread_count() == 3


def test_mark_read_with_no_ids_does_nothing(monkeypatch):
    conn = _install(monkeypatch, _router())

    assert notification_service.mark_read([]) == 0
    assert conn.calls == []


def test_mark_read_returns_how_many_were_newly_marked(monkeypatch):
    _install(monkeypatch, _router(affected=2))

    assert notification_service.mark_read([1, 2, 3]) == 2


def test_insert_within_a_callers_connection_does_not_open_its_own(monkeypatch):
    conn = _install(monkeypatch, _router())
    opened = []
    monkeypatch.setattr(notification_service, "_get_engine", lambda: opened.append(1) or FakeEngine(conn))

    notification_id = notification_service.insert(
        notification_service.LOW_STOCK, {"sku": "A1"}, customer_id=1, skus=["A1"], conn=conn
    )

    assert notification_id == 99
    assert opened == []  # _get_engine was never called -- the given conn was used directly


def test_insert_with_no_conn_opens_and_commits_its_own(monkeypatch):
    _install(monkeypatch, _router())

    notification_id = notification_service.insert(notification_service.FORECAST_SUCCESS, {"skus": []})

    assert notification_id == 99


def test_already_alerted_skus_reads_only_unread_low_stock_for_that_customer(monkeypatch):
    conn = _install(monkeypatch, _router(rows=["A1", "B2"]))

    skus = notification_service.already_alerted_skus(conn, customer_id=1)

    assert skus == {"A1", "B2"}
    sql, params = conn.calls[0]
    assert "read_at IS NULL" in sql
    assert params["notification_type"] == notification_service.LOW_STOCK
    assert params["customer_id"] == 1
