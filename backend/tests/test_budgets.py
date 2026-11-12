import json
from datetime import date, datetime, timezone

import pytest

pytestmark = pytest.mark.usefixtures("migrated_budget_schema")
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from conftest import FakeConnection, FakeEngine

from app.main import app
from app.services.scenario import budgets, common
from test_budget_calc import initial


STAMP = datetime(2026, 11, 12, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _initial_breakdown(monkeypatch):
    def breakdown(year, forecast_rows):
        return {"basis": "initial", "year": year, "data_cutoff": "2026-10-01", "unavailable": [], "rows": [
            {"customer_id": row["customer_id"], "sku": row["sku"], "month_year": row["month_year"],
             "tier0": row["forecast_initial"], "baseline": row["forecast_initial"], "carried": 0} for row in forecast_rows
        ]}
    monkeypatch.setattr(budgets.initial_breakdown, "get_initial_breakdown", breakdown)


def test_lock_appends_all_months_records_identity_and_serializes_versions(monkeypatch):
    def respond(sql, params):
        if "INSERT INTO budget_snapshots" in sql:
            return [{"snapshot_id": 4, "year": 2027, "version": 2, "locked_at": STAMP, "locked_by": params["locked_by"]}]
        return []
    conn = FakeConnection(respond)
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", lambda **kwargs: initial())
    saved = budgets.lock_budget(2027, "staff@example.com")
    assert saved["version"] == 2 and saved["row_count"] == 12
    assert saved["locked_at"].endswith("+00:00")
    assert conn.sql_containing("pg_advisory_xact_lock")[0][1] == {"year": 2027}
    inserts = conn.sql_containing("INSERT INTO budget_snapshot_rows")[0][1]
    assert len(inserts) == 12 and all(row["snapshot_id"] == 4 for row in inserts)
    assert not conn.sql_containing("UPDATE") and not conn.sql_containing("DELETE")
    inputs = json.loads(conn.sql_containing("INSERT INTO budget_snapshots")[0][1]["inputs"])
    assert inputs["initial_breakdown"]["data_cutoff"] == "2026-10-01"
    assert len(inputs["initial_breakdown"]["rows"]) == 12


def test_unreconciled_initial_never_enters_the_budget_writing_transaction(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "get_engine", lambda: pytest.fail("Do not start a write when the split is unavailable"))
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", lambda **_: initial())
    monkeypatch.setattr(budgets.initial_breakdown, "get_initial_breakdown", lambda *args, **kwargs: {
        "rows": [], "unavailable": [{"reason": "No Initial data cut-off"}],
    })
    with pytest.raises(ValueError, match="No Initial data cut-off"):
        budgets.lock_budget(2027, "staff@example.com")
    assert not conn.sql_containing("INSERT")


def test_invalid_initial_never_inserts_a_snapshot(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", lambda **kwargs: initial()[:-1])
    with pytest.raises(ValueError):
        budgets.lock_budget(2027, "staff@example.com")
    assert not conn.sql_containing("INSERT")


def test_history_keeps_old_versions_and_selects_latest_per_year(monkeypatch):
    history = [{"snapshot_id": i, "year": year, "version": version, "locked_at": STAMP, "locked_by": "staff"}
               for i, year, version in [(3, 2027, 2), (2, 2027, 1), (1, 2026, 1)]]
    conn = FakeConnection(lambda sql, params: [row for row in history if params["year"] is None or row["year"] == params["year"]] if "FROM budget_snapshots" in sql else [])
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    assert len(budgets.read_budgets()["history"]) == 3
    assert conn.sql_containing("FROM budget_snapshot_rows")[0][1]["ids"] == [3, 1]
    budgets.read_budgets(2027, 1)
    assert conn.sql_containing("FROM budget_snapshot_rows")[-1][1]["ids"] == [2]


def test_inventory_reads_only_the_customers_latest_locked_sellout(monkeypatch):
    conn = FakeConnection(lambda sql, params: [{"sku": "A", "month_year": date(2027, 1, 1), "units": 123}])
    assert budgets.sellout_for_customer(conn, 9) == {"A": {date(2027, 1, 1): 123}}
    assert conn.calls[0][1] == {"customer_id": 9}
    assert "version DESC" in conn.calls[0][0]


def test_reading_a_lock_never_recalculates_its_units_from_new_forecasts(monkeypatch):
    def no_forecast(**kwargs):
        pytest.fail("Frozen budgets must not read BigQuery")
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", no_forecast)
    header = {"snapshot_id": 1, "year": 2027, "version": 1, "locked_at": STAMP, "locked_by": "staff"}
    row = {"snapshot_id": 1, "customer_id": 1, "sku": "A", "customer_name": "Old customer", "current_customer_name": "Renamed customer",
           "product_name": "Old name", "current_product_name": "Renamed SKU", "sku_range": "Pants", "current_sku_range": "Pants",
           "month_year": date(2027, 1, 1), "units": 123}
    conn = FakeConnection(lambda sql, params: [header] if "FROM budget_snapshots" in sql else [row])
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    result = budgets.read_budgets(2027)
    assert result["rows"][0]["units"] == 123
    assert result["rows"][0]["product_name"] == "Renamed SKU"
    assert result["rows"][0]["customer_name"] == "Renamed customer"


def test_lock_endpoint_uses_signed_in_identity(monkeypatch, signed_in):
    seen = []
    monkeypatch.setattr(budgets, "lock_budget", lambda year, email: seen.append((year, email)) or {"version": 1})
    response = TestClient(app).post("/api/scenario/budgets/lock", json={"year": 2027, "locked_by": "forged"})
    assert response.status_code == 201
    assert seen == [(2027, "staff@shop-aire.com")]


def test_read_endpoint_passes_version_and_lock_rejects_bad_input(monkeypatch):
    monkeypatch.setattr(budgets, "read_budgets", lambda year, version: {"year": year, "version": version})
    assert TestClient(app).get("/api/scenario/budgets?year=2027&version=2").json() == {"year": 2027, "version": 2}
    monkeypatch.setattr(budgets, "lock_budget", lambda *args: pytest.fail("must validate before writing"))
    assert TestClient(app).post("/api/scenario/budgets/lock", json={"year": 1}).status_code == 422


def test_lock_maps_missing_initial_and_database_outage(monkeypatch):
    def fail(*args):
        raise ValueError("No Initial exists")
    monkeypatch.setattr(budgets, "lock_budget", fail)
    assert TestClient(app).post("/api/scenario/budgets/lock", json={"year": 2027}).status_code == 400
    def down(*args):
        raise OperationalError("offline", {}, Exception("offline"))
    monkeypatch.setattr(budgets, "read_budgets", down)
    assert TestClient(app).get("/api/scenario/budgets").status_code == 503
