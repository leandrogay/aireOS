from fastapi.testclient import TestClient

from app.main import app
from app.services import catalog_service


client = TestClient(app)


SKU_PAYLOAD = {
    "sku": "NEW-001",
    "sku_range": "Adult Pants",
    "product_name": "Aire Adult Pants M",
    "size": "M",
    "brand": "AIRE",
    "uom": "EA",
    "pack_size": 8,
    "price": "12.50",
}


def test_create_sku_requires_every_master_field():
    response = client.post(
        "/api/catalog/skus",
        json={"sku": "NEW-001"},
    )

    assert response.status_code == 422


def test_create_sku_returns_conflict_for_a_used_code(monkeypatch):
    def duplicate(_sku):
        raise catalog_service.SkuAlreadyExistsError("SKU NEW-001 already exists.")

    monkeypatch.setattr(catalog_service, "create_sku", duplicate)

    response = client.post("/api/catalog/skus", json=SKU_PAYLOAD)

    assert response.status_code == 409
    assert response.json()["detail"] == "SKU NEW-001 already exists."


def test_sku_code_is_not_part_of_the_update_contract(monkeypatch):
    captured = {}

    def update(sku, changes):
        captured["sku"] = sku
        captured["changes"] = changes.model_dump()
        return {"sku": sku, **captured["changes"]}

    monkeypatch.setattr(catalog_service, "update_sku", update)
    payload = {key: value for key, value in SKU_PAYLOAD.items() if key != "sku"}

    response = client.put("/api/catalog/skus/NEW-001", json=payload)

    assert response.status_code == 200
    assert captured["sku"] == "NEW-001"
    assert "sku" not in captured["changes"]


def test_sku_options_uses_the_static_route(monkeypatch):
    expected = {
        "sku_ranges": ["Adult Pants"],
        "brands": ["AIRE"],
        "sizes": ["M"],
        "uoms": ["EA"],
        "pack_sizes": [8],
    }
    monkeypatch.setattr(catalog_service, "get_sku_options", lambda: expected)

    response = client.get("/api/catalog/skus/options")

    assert response.status_code == 200
    assert response.json() == expected


def test_archive_sku_returns_conflict_when_it_has_promotions(monkeypatch):
    def blocked(_sku):
        raise catalog_service.SkuHasPromotionsError(
            "SKU cannot be archived because it is attached to promotions."
        )

    monkeypatch.setattr(catalog_service, "archive_sku", blocked)

    response = client.delete("/api/catalog/skus/NEW-001")

    assert response.status_code == 409
    assert "attached to promotions" in response.json()["detail"]
