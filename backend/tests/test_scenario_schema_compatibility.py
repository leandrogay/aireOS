from datetime import date
import re

import pytest
from conftest import FakeConnection, FakeEngine
from fastapi.testclient import TestClient

from app.main import app
from app.services.scenario import budgets, building_blocks, common, promotions
from test_scenario_building_blocks_service import FakeBlocksDatabase, _block
from test_scenario_promotions_service import FakePromotionsDatabase, _promotion


def _legacy_database(monkeypatch, database):
    def respond(sql, params):
        if "FROM pg_attribute" in sql:
            return [(False,)]
        if "to_regclass('public.budget_snapshots')" in sql:
            return [(False,)]
        # Fail at the same boundary as the real pre-026 database.
        assert not re.search(r"\b(?:block|promotion)\.plan\b", sql)
        if sql.startswith(("INSERT", "UPDATE", "DELETE")) or "kind = 'growth'" in sql:
            assert not re.search(r"\bplan\b", sql)
        return database.respond(sql, params)

    conn = FakeConnection(respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


def test_current_blocks_can_load_save_update_and_delete_before_migration_026(monkeypatch):
    conn = _legacy_database(monkeypatch, FakeBlocksDatabase())
    saved = building_blocks.create_building_block(_block())
    assert saved["plan"] == "scenario"
    assert building_blocks.list_building_blocks()[0]["block_id"] == saved["block_id"]
    changed = building_blocks.update_building_block(saved["block_id"], _block(name="Updated block"))
    assert changed["name"] == "Updated block"
    assert building_blocks.delete_building_block(saved["block_id"])
    assert building_blocks.list_building_blocks() == []
    assert all(params["table_name"] == "public.scenario_building_blocks" for _, params in conn.sql_containing("FROM pg_attribute"))


def test_current_promotions_can_load_save_update_and_delete_before_migration_026(monkeypatch):
    _legacy_database(monkeypatch, FakePromotionsDatabase())
    saved = promotions.create_scenario_promotion(_promotion())
    assert saved["plan"] == "scenario"
    assert promotions.list_scenario_promotions()[0]["promotion_id"] == saved["promotion_id"]
    changed = promotions.update_scenario_promotion(saved["promotion_id"], _promotion(explanation="Updated"))
    assert changed["explanation"] == "Updated"
    assert promotions.delete_scenario_promotion(saved["promotion_id"])
    assert promotions.list_scenario_promotions() == []


def test_legacy_growth_still_checks_uniqueness_without_a_plan_column(monkeypatch):
    _legacy_database(monkeypatch, FakeBlocksDatabase())
    growth = _block(kind="growth", start_month=date(2027, 1, 1), end_month=date(2027, 12, 1))
    building_blocks.create_building_block(growth)
    with pytest.raises(building_blocks.GrowthBlockExistsError):
        building_blocks.create_building_block(growth)


@pytest.mark.parametrize("service,create,update,delete,listing,payload", [
    (building_blocks, "create_building_block", "update_building_block", "delete_building_block", "list_building_blocks", _block(plan="budget")),
    (promotions, "create_scenario_promotion", "update_scenario_promotion", "delete_scenario_promotion", "list_scenario_promotions", _promotion(plan="budget")),
])
def test_budget_requests_never_fall_back_to_current_entries(monkeypatch, service, create, update, delete, listing, payload):
    conn = _legacy_database(monkeypatch, FakeBlocksDatabase())
    for action in [lambda: getattr(service, create)(payload), lambda: getattr(service, update)(1, payload),
                   lambda: getattr(service, delete)(1, "budget"), lambda: getattr(service, listing)("budget")]:
        with pytest.raises(common.BudgetSetupRequiredError, match="026_budget_planning.sql"):
            action()
    assert not conn.sql_containing("INSERT")
    assert not conn.sql_containing("UPDATE")
    assert not conn.sql_containing("DELETE")


def test_inventory_overlay_and_budget_line_work_with_the_legacy_schema(monkeypatch):
    conn = _legacy_database(monkeypatch, FakeBlocksDatabase())
    assert building_blocks.fetch_blocks_for_customer(conn, 1, [4]) == []
    assert budgets.sellout_for_customer(conn, 1) == {}
    assert not conn.sql_containing("FROM budget_snapshot_rows")


def test_missing_snapshot_tables_report_setup_without_breaking_forecast_reads(monkeypatch):
    _legacy_database(monkeypatch, FakeBlocksDatabase())
    result = budgets.read_budgets()
    assert result["rows"] == [] and result["history"] == [] and result["setup_required"]
    with pytest.raises(common.BudgetSetupRequiredError):
        budgets.read_budgets(2027)


def test_lock_checks_migration_before_reading_bigquery_or_writing(monkeypatch):
    conn = _legacy_database(monkeypatch, FakeBlocksDatabase())
    def no_forecast(**kwargs):
        pytest.fail("The forecast must not be loaded before setup is complete")
    monkeypatch.setattr(budgets.bigquery, "get_forecast_output_rows", no_forecast)
    with pytest.raises(common.BudgetSetupRequiredError):
        budgets.lock_budget(2027, "staff")
    assert not conn.sql_containing("INSERT")


def test_schema_checks_see_a_newly_applied_migration_without_a_restart():
    ready = False
    conn = FakeConnection(lambda sql, params: [(ready,)])
    assert not common.has_plan_column(conn, "scenario_building_blocks")
    ready = True
    assert common.has_plan_column(conn, "scenario_building_blocks")
    with pytest.raises(ValueError):
        common.has_plan_column(conn, "untrusted_table")


def test_budget_routes_return_an_actionable_setup_error_and_current_routes_still_load(monkeypatch):
    _legacy_database(monkeypatch, FakeBlocksDatabase())
    client = TestClient(app)
    assert client.get("/api/scenario/building-blocks").status_code == 200
    for path in ["/api/scenario/building-blocks?plan=budget", "/api/scenario/promotions?plan=budget", "/api/scenario/budgets?year=2027"]:
        response = client.get(path)
        assert response.status_code == 503
        assert "026_budget_planning.sql" in response.json()["detail"]
        assert "pg8000" not in response.json()["detail"]
