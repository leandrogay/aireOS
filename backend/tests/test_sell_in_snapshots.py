from datetime import date

from conftest import FakeConnection, FakeEngine

from app.services import forecast_units, inventory_service, sell_in_snapshots

NOV = date(2026, 11, 1)


def _plan(*rows):
    return {"rows": [{"sku": sku, "month": month, "recommended_sell_in": value} for sku, month, value in rows]}


def _install(monkeypatch, plans):
    """plans: {customer_id: plan dict, or an exception to raise}."""

    conn = FakeConnection()
    monkeypatch.setattr(sell_in_snapshots, "_get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(inventory_service, "_current_month", lambda: NOV)
    monkeypatch.setattr(
        inventory_service,
        "list_customers",
        lambda: [{"customer_id": customer_id, "customer_name": f"c{customer_id}"} for customer_id in plans],
    )
    asked = []

    def get_sell_in_plan(customer_id, months, forecast_lines=None):
        asked.append((customer_id, months))
        plan = plans[customer_id]
        if isinstance(plan, Exception):
            raise plan
        return plan

    monkeypatch.setattr(inventory_service, "get_sell_in_plan", get_sell_in_plan)
    monkeypatch.setattr(
        forecast_units, "get_forecast_lines_by_customer", lambda customer_ids: {i: {} for i in customer_ids}, raising=False
    )
    return conn, asked


# ---- take_snapshot ------------------------------------------------------------------


def test_every_customers_plan_is_saved_under_the_current_month(monkeypatch):
    conn, _ = _install(monkeypatch, {
        1: _plan(("A1", "2026-12-01", 120.0), ("B2", "2027-01-01", 30.0)),
        2: _plan(("A1", "2026-12-01", 8.0)),
    })

    result = sell_in_snapshots.take_snapshot()

    assert result == {"snapshot_month": "2026-11-01", "saved": [1, 2], "failed": []}
    inserts = conn.sql_containing("INSERT INTO sell_in_plan_snapshots")
    assert inserts[0][1] == [
        {"customer_id": 1, "sku": "A1", "snapshot_month": NOV, "plan_month": date(2026, 12, 1), "recommended_sell_in": 120.0},
        {"customer_id": 1, "sku": "B2", "snapshot_month": NOV, "plan_month": date(2027, 1, 1), "recommended_sell_in": 30.0},
    ]
    assert inserts[1][1][0]["customer_id"] == 2


def test_the_plan_is_saved_as_far_ahead_as_the_page_can_show(monkeypatch):
    _, asked = _install(monkeypatch, {1: _plan()})

    sell_in_snapshots.take_snapshot()

    assert asked == [(1, 12)]


def test_a_second_refresh_in_the_month_replaces_that_months_snapshot(monkeypatch):
    conn, _ = _install(monkeypatch, {1: _plan(("A1", "2026-12-01", 120.0))})

    sell_in_snapshots.take_snapshot()

    deleted = conn.sql_containing("DELETE FROM sell_in_plan_snapshots")
    assert deleted[0][1] == {"customer_id": 1, "snapshot_month": NOV}
    assert conn.calls.index(deleted[0]) < conn.calls.index(conn.sql_containing("INSERT INTO")[0])


def test_a_customer_with_nothing_to_plan_clears_that_months_snapshot(monkeypatch):
    conn, _ = _install(monkeypatch, {1: _plan()})

    sell_in_snapshots.take_snapshot()

    assert conn.sql_containing("DELETE FROM sell_in_plan_snapshots")
    assert conn.sql_containing("INSERT INTO") == []


def test_one_customer_failing_does_not_stop_the_others(monkeypatch):
    conn, _ = _install(monkeypatch, {1: RuntimeError("BigQuery down"), 2: _plan(("A1", "2026-12-01", 8.0))})

    result = sell_in_snapshots.take_snapshot()

    assert result["saved"] == [2]
    assert result["failed"] == [1]
    assert conn.sql_containing("INSERT INTO")[0][1][0]["customer_id"] == 2


def test_the_best_effort_snapshot_never_raises(monkeypatch):
    def broken():
        raise RuntimeError("Cloud SQL down")

    monkeypatch.setattr(inventory_service, "list_customers", broken)
    monkeypatch.setattr(inventory_service, "_current_month", lambda: NOV)

    sell_in_snapshots.take_snapshot_best_effort()


def test_the_forecast_is_read_once_and_shared_across_customers(monkeypatch):
    _install(monkeypatch, {1: _plan(), 2: _plan()})
    lines = {1: {"current": {"A1": {}}}, 2: {"current": {"B2": {}}}}
    reads, given = [], {}

    def read_lines(customer_ids):
        reads.append(list(customer_ids))
        return lines

    def plan(customer_id, months, forecast_lines=None):
        given[customer_id] = forecast_lines
        return _plan()

    monkeypatch.setattr(forecast_units, "get_forecast_lines_by_customer", read_lines, raising=False)
    monkeypatch.setattr(inventory_service, "get_sell_in_plan", plan)

    sell_in_snapshots.take_snapshot()

    assert reads == [[1, 2]]
    assert given == lines
