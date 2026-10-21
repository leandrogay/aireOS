from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, OperationalError

from app.main import app
from app.services.scenario import building_blocks as building_blocks_service

client = TestClient(app)

BODY = {
    "customer_name": "fairprice",
    "product_name": None,
    "name": "New Store Opening",
    "explanation": None,
    "uplift_mode": "units",
    "uplift_value": 900,
    "start_month": "2026-11-01",
    "end_month": "2026-12-01",
    "is_active": True,
}

SAVED = {
    **BODY,
    "block_id": 1,
    "sku": None,
    "uplift_value": 900.0,
    "created_at": "2026-10-22T08:00:00+00:00",
    "updated_at": "2026-10-22T08:00:00+00:00",
}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


# ---- List --------------------------------------------------------------------


def test_list_returns_the_service_rows(monkeypatch):
    monkeypatch.setattr(building_blocks_service, "list_building_blocks", lambda: [SAVED])

    response = client.get("/api/scenario/building-blocks")

    assert response.status_code == 200
    assert response.json() == [SAVED]


def test_list_with_the_database_down_is_503(monkeypatch):
    monkeypatch.setattr(
        building_blocks_service,
        "list_building_blocks",
        _raises(OperationalError("SELECT", {}, Exception("connection refused"))),
    )

    response = client.get("/api/scenario/building-blocks")

    assert response.status_code == 503
    assert "Cloud SQL" in response.json()["detail"]


# ---- Create ------------------------------------------------------------------


def test_create_is_201_and_passes_the_validated_body(monkeypatch):
    seen = {}

    def fake(block):
        seen.update(block)
        return SAVED

    monkeypatch.setattr(building_blocks_service, "create_building_block", fake)

    response = client.post("/api/scenario/building-blocks", json=BODY)

    assert response.status_code == 201
    assert response.json() == SAVED
    assert seen["customer_name"] == "fairprice"
    assert seen["uplift_mode"] == "units"


def test_create_with_an_invalid_body_is_422_without_calling_the_service(monkeypatch):
    monkeypatch.setattr(
        building_blocks_service,
        "create_building_block",
        _raises(AssertionError("service must not be called")),
    )

    response = client.post(
        "/api/scenario/building-blocks",
        json={**BODY, "uplift_mode": "pct", "uplift_value": 80},
    )

    assert response.status_code == 422


def test_create_with_an_unknown_customer_is_400(monkeypatch):
    monkeypatch.setattr(
        building_blocks_service,
        "create_building_block",
        _raises(ValueError("Unknown customer: giant")),
    )

    response = client.post("/api/scenario/building-blocks", json={**BODY, "customer_name": "giant"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown customer: giant"


def test_create_racing_a_deleted_customer_is_409(monkeypatch):
    monkeypatch.setattr(
        building_blocks_service,
        "create_building_block",
        _raises(IntegrityError("INSERT", {}, Exception("fk violation"))),
    )

    response = client.post("/api/scenario/building-blocks", json=BODY)

    assert response.status_code == 409


# ---- Update ------------------------------------------------------------------


def test_update_returns_the_saved_block(monkeypatch):
    seen = {}

    def fake(block_id, block):
        seen.update(block_id=block_id, is_active=block["is_active"])
        return {**SAVED, "is_active": False}

    monkeypatch.setattr(building_blocks_service, "update_building_block", fake)

    response = client.put("/api/scenario/building-blocks/1", json={**BODY, "is_active": False})

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert seen == {"block_id": 1, "is_active": False}


def test_update_of_a_missing_block_is_404(monkeypatch):
    monkeypatch.setattr(building_blocks_service, "update_building_block", lambda block_id, block: None)

    response = client.put("/api/scenario/building-blocks/99", json=BODY)

    assert response.status_code == 404
    assert response.json()["detail"] == "Building block not found"


# ---- Delete ------------------------------------------------------------------


def test_delete_returns_deleted_true(monkeypatch):
    monkeypatch.setattr(building_blocks_service, "delete_building_block", lambda block_id: True)

    response = client.delete("/api/scenario/building-blocks/1")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}


def test_delete_of_a_missing_block_is_404(monkeypatch):
    monkeypatch.setattr(building_blocks_service, "delete_building_block", lambda block_id: False)

    response = client.delete("/api/scenario/building-blocks/99")

    assert response.status_code == 404
