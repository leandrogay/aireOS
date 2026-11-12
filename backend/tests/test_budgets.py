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
    assert not conn.sql_containing("DELETE")
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


def _history_connection(history):
    return FakeConnection(lambda sql, params: [row for row in history if params["year"] is None or row["year"] == params["year"]]
                          if "FROM budget_snapshots s" in sql else [])


def test_history_keeps_old_versions_and_selects_the_official_one_per_year(monkeypatch):
    # 2027's official version is the older one: the newest lock was an experiment.
    history = [{"snapshot_id": i, "year": year, "version": version, "name": None, "is_official": official,
                "locked_at": STAMP, "locked_by": "staff", "total_units": 100}
               for i, year, version, official in [(3, 2027, 2, False), (2, 2027, 1, True), (1, 2026, 1, True)]]
    conn = _history_connection(history)
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    result = budgets.read_budgets()
    assert len(result["history"]) == 3 and result["history"][0]["total_units"] == 100.0
    assert conn.sql_containing("FROM budget_snapshot_rows r LEFT JOIN")[0][1]["ids"] == [2, 1]
    budgets.read_budgets(2027, 2)
    assert conn.sql_containing("FROM budget_snapshot_rows r LEFT JOIN")[-1][1]["ids"] == [3]


def test_inventory_reads_only_the_customers_official_locked_sellout(monkeypatch):
    conn = FakeConnection(lambda sql, params: [{"sku": "A", "month_year": date(2027, 1, 1), "units": 123}])
    assert budgets.sellout_for_customer(conn, 9) == {"A": {date(2027, 1, 1): 123}}
    assert conn.calls[0][1] == {"customer_id": 9}
    assert "s.is_official" in conn.calls[0][0]


def test_reading_a_lock_never_recalculates_its_units_from_new_forecasts(monkeypatch):
    def no_forecast(**kwargs):
        pytest.fail("Frozen budgets must not read BigQuery")
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", no_forecast)
    header = {"snapshot_id": 1, "year": 2027, "version": 1, "name": None, "is_official": True, "locked_at": STAMP, "locked_by": "staff"}
    row = {"snapshot_id": 1, "customer_id": 1, "sku": "A", "customer_name": "Old customer", "current_customer_name": "Renamed customer",
           "product_name": "Old name", "current_product_name": "Renamed SKU", "sku_range": "Pants", "current_sku_range": "Pants",
           "month_year": date(2027, 1, 1), "units": 123}
    conn = FakeConnection(lambda sql, params: [header] if "FROM budget_snapshots s" in sql else [row])
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    result = budgets.read_budgets(2027)
    assert result["rows"][0]["units"] == 123
    assert result["rows"][0]["product_name"] == "Renamed SKU"
    assert result["rows"][0]["customer_name"] == "Renamed customer"


def test_lock_endpoint_uses_signed_in_identity(monkeypatch, signed_in):
    seen = []
    monkeypatch.setattr(budgets, "lock_budget", lambda *args: seen.append(args) or {"version": 1})
    response = TestClient(app).post("/api/scenario/budgets/lock", json={"year": 2027, "locked_by": "forged", "name": " Base case "})
    assert response.status_code == 201
    assert seen == [(2027, "staff@shop-aire.com", "Base case", True)]


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


# ---- Official version ------------------------------------------------------


def _lock_connection(has_official):
    def respond(sql, params):
        if "INSERT INTO budget_snapshots" in sql:
            return [{"snapshot_id": 5, "year": 2027, "version": 3, "name": params["name"], "locked_at": STAMP, "locked_by": "staff"}]
        if "SELECT EXISTS" in sql:
            return [(has_official,)]
        return []
    return FakeConnection(respond)


def _lock(monkeypatch, conn, **kwargs):
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", lambda **_: initial())
    return budgets.lock_budget(2027, "staff", **kwargs)


def test_a_lock_not_made_official_leaves_the_official_version_alone(monkeypatch):
    conn = _lock_connection(has_official=True)
    saved = _lock(monkeypatch, conn, name="Aggressive", make_official=False)
    assert saved["is_official"] is False and saved["name"] == "Aggressive"
    assert not conn.sql_containing("UPDATE budget_snapshots")


def test_the_years_first_lock_is_official_even_when_not_asked(monkeypatch):
    conn = _lock_connection(has_official=False)
    assert _lock(monkeypatch, conn, make_official=False)["is_official"] is True
    updates = conn.sql_containing("UPDATE budget_snapshots")
    # Cleared first, then set: the one-official-per-year index is checked row by row.
    assert "is_official = FALSE" in updates[0][0] and updates[1][1] == {"snapshot_id": 5}


def test_lock_reads_only_the_years_budget_entries(monkeypatch):
    conn = _lock_connection(has_official=True)
    _lock(monkeypatch, conn)
    for fragment in ("block.plan = 'budget'", "promotion.plan = 'budget'"):
        sql, params = conn.sql_containing(fragment)[0]
        assert "start_month <= :year_end" in sql
        assert params == {"year_start": date(2027, 1, 1), "year_end": date(2027, 12, 1)}


def test_set_official_moves_the_flag_and_a_missing_version_is_none(monkeypatch):
    header = {"snapshot_id": 2, "year": 2027, "version": 1, "name": "Base", "locked_at": STAMP, "locked_by": "staff"}
    conn = FakeConnection(lambda sql, params: [header] if "WHERE year = :year AND version = :version" in sql and params["version"] == 1 else [])
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    assert budgets.set_official(2027, 1)["is_official"] is True
    assert conn.sql_containing("SET is_official = TRUE")[0][1] == {"snapshot_id": 2}
    assert budgets.set_official(2027, 9) is None


def test_official_endpoint_maps_a_missing_version_to_404(monkeypatch):
    monkeypatch.setattr(budgets, "set_official", lambda year, version: None)
    assert TestClient(app).post("/api/scenario/budgets/official", json={"year": 2027, "version": 4}).status_code == 404
    monkeypatch.setattr(budgets, "set_official", lambda year, version: {"version": version})
    assert TestClient(app).post("/api/scenario/budgets/official", json={"year": 2027, "version": 4}).json() == {"version": 4}


# ---- Starting a budget -----------------------------------------------------


def _saved_block(**changes):
    return {"block_id": 7, "plan": "budget", "kind": "block", "customer_names": ["FairPrice"], "sku_ranges": None,
            "excluded_pairs": [], "sku": None, "product_name": None, "name": "New store", "explanation": None,
            "uplift_mode": "pct", "uplift_value": 10.0, "start_month": "2027-03-01", "end_month": "2027-05-01",
            "is_active": True, "created_at": "2026-11-01T00:00:00+00:00", "updated_at": None, **changes}


def _start(monkeypatch, inputs):
    conn = FakeConnection(lambda sql, params: [(inputs,)] if "SELECT inputs" in sql else [])
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    copied = []
    monkeypatch.setattr(budgets.building_blocks, "insert_building_block", lambda conn, block: copied.append(block))
    monkeypatch.setattr(budgets.promotions, "insert_scenario_promotion", lambda conn, promotion: copied.append(promotion))
    return conn, copied


def test_starting_from_a_version_replaces_the_years_entries_with_its_copies(monkeypatch):
    other_year = _saved_block(start_month="2028-01-01", end_month="2028-02-01")
    conn, copied = _start(monkeypatch, {"blocks": [_saved_block(), other_year], "promotions": []})
    assert budgets.start_budget(2027, 2) == {"year": 2027, "version": 2, "blocks": 1, "promotions": 0}
    deletes = conn.sql_containing("DELETE FROM")
    assert len(deletes) == 2 and all("plan = 'budget'" in sql and params["year_start"] == date(2027, 1, 1) for sql, params in deletes)
    # Copied as a create request: plan budget, dates parsed, no saved ids.
    assert copied[0]["plan"] == "budget" and copied[0]["start_month"] == date(2027, 3, 1) and "block_id" not in copied[0]


def test_starting_from_scratch_only_clears_the_years_entries(monkeypatch):
    conn, copied = _start(monkeypatch, None)
    assert budgets.start_budget(2027, None)["blocks"] == 0
    assert not conn.sql_containing("SELECT inputs") and len(conn.sql_containing("DELETE FROM")) == 2 and copied == []


def test_starting_from_a_missing_version_changes_nothing(monkeypatch):
    conn, _ = _start(monkeypatch, None)
    assert budgets.start_budget(2027, 9) is None
    assert not conn.sql_containing("DELETE")


def test_start_endpoint_maps_missing_versions_and_stale_entries(monkeypatch):
    monkeypatch.setattr(budgets, "start_budget", lambda year, version: None)
    assert TestClient(app).post("/api/scenario/budgets/start", json={"year": 2027, "version": 3}).status_code == 404
    def stale(year, version):
        raise ValueError("Unknown customer: Gone")
    monkeypatch.setattr(budgets, "start_budget", stale)
    response = TestClient(app).post("/api/scenario/budgets/start", json={"year": 2027, "version": 3})
    assert response.status_code == 400 and response.json()["detail"] == "Unknown customer: Gone"


# ---- Deleting a version ----------------------------------------------------


def _version_connection(found):
    return FakeConnection(lambda sql, params: [found] if found and "SELECT snapshot_id, is_official" in sql else [])


def test_deleting_a_version_only_stamps_it_and_keeps_its_rows(monkeypatch):
    conn = _version_connection({"snapshot_id": 4, "is_official": False})
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    assert budgets.delete_version(2027, 3, "staff@example.com") is True
    sql, params = conn.sql_containing("UPDATE budget_snapshots SET deleted_at")[0]
    assert params == {"snapshot_id": 4, "deleted_by": "staff@example.com"}
    assert not conn.sql_containing("DELETE")


def test_the_official_version_cannot_be_deleted(monkeypatch):
    conn = _version_connection({"snapshot_id": 4, "is_official": True})
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    with pytest.raises(budgets.OfficialBudgetDeleteError):
        budgets.delete_version(2027, 3, "staff")
    assert not conn.sql_containing("UPDATE")


def test_deleted_versions_are_never_listed_copied_or_made_official(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    budgets.read_budgets(2027)
    assert budgets.set_official(2027, 3) is None
    assert budgets.start_budget(2027, 3) is None
    assert budgets.delete_version(2027, 3, "staff") is False
    for fragment in ("FROM budget_snapshots s", "AND version = :version"):
        assert all("deleted_at IS NULL" in sql for sql, _ in conn.sql_containing(fragment))


def test_delete_endpoint_records_identity_and_maps_errors(monkeypatch, signed_in):
    seen = []
    monkeypatch.setattr(budgets, "delete_version", lambda *args: seen.append(args) or True)
    assert TestClient(app).delete("/api/scenario/budgets/2027/versions/3").json() == {"deleted": True}
    assert seen == [(2027, 3, "staff@shop-aire.com")]
    monkeypatch.setattr(budgets, "delete_version", lambda *args: False)
    assert TestClient(app).delete("/api/scenario/budgets/2027/versions/3").status_code == 404
    def official(*args):
        raise budgets.OfficialBudgetDeleteError("The official budget can't be deleted.")
    monkeypatch.setattr(budgets, "delete_version", official)
    assert TestClient(app).delete("/api/scenario/budgets/2027/versions/3").status_code == 409
