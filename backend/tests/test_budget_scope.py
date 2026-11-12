from datetime import date

import pytest

pytestmark = pytest.mark.usefixtures("migrated_budget_schema")
from conftest import FakeConnection, FakeEngine

from app.schemas.scenario.building_blocks import ScenarioBuildingBlockCreate
from app.schemas.scenario.promotions import ScenarioPromotionCreate
from app.services.scenario import building_blocks, common, promotions
from test_scenario_building_blocks_service import _block
from test_scenario_promotions_router import BODY


@pytest.mark.parametrize("service,listing,delete,alias", [
    (building_blocks, "list_building_blocks", "delete_building_block", "block"),
    (promotions, "list_scenario_promotions", "delete_scenario_promotion", "promotion"),
])
def test_budget_lists_and_deletes_bind_the_plan_and_default_to_scenario(monkeypatch, service, listing, delete, alias):
    conn = FakeConnection()
    monkeypatch.setattr(common, "read_connection", lambda: FakeEngine(conn))
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    getattr(service, listing)("budget")
    assert f"{alias}.plan = :plan" in conn.calls[-1][0]
    assert conn.calls[-1][1] == {"plan": "budget"}
    getattr(service, delete)(3, "budget")
    assert "AND plan = :plan" in conn.calls[-1][0]
    assert conn.calls[-1][1]["plan"] == "budget"
    getattr(service, listing)()
    assert conn.calls[-1][1] == {"plan": "scenario"}


def test_updates_cannot_move_a_scenario_into_a_budget(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))
    assert building_blocks.update_building_block(1, _block(customer_names=None, plan="budget")) is None
    payload = ScenarioPromotionCreate(**{**BODY, "customer_names": None, "product_name": None, "plan": "budget"}).model_dump()
    assert promotions.update_scenario_promotion(2, payload) is None
    for sql, params in conn.calls:
        if sql.startswith("UPDATE"):
            assert "AND plan = :plan" in sql and params["plan"] == "budget"


@pytest.mark.parametrize("schema,body", [(ScenarioBuildingBlockCreate, _block()), (ScenarioPromotionCreate, BODY)])
def test_budget_entries_cannot_spread_units_across_years(schema, body):
    with pytest.raises(ValueError, match="one calendar year"):
        schema(**{**body, "plan": "budget", "start_month": "2027-12-01", "end_month": "2028-01-01"})


def test_growth_uniqueness_is_per_plan_and_inventory_overlay_only_offers_scenarios(monkeypatch):
    conn = FakeConnection()
    building_blocks._ensure_one_growth_per_year(conn, {}, {"kind": "growth", "plan": "budget", "customer_id": 1,
        "start_month": date(2027, 1, 1)}, None)
    assert "plan = :plan" in conn.calls[-1][0] and conn.calls[-1][1]["plan"] == "budget"
    building_blocks.fetch_blocks_for_customer(conn, 1, [4])
    assert "block.plan = 'scenario'" in conn.calls[-1][0]
