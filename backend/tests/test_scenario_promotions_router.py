from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, OperationalError

from app.main import app
from app.services.scenario import promotions as promotions_service

client = TestClient(app)

BODY = {
    "customer_name": "fairprice",
    "product_name": "Comfort Pants M",
    "promo_type": "monthly",
    "mechanic_key": "pct_off_30",
    "mechanic_label": "30% Off",
    "reference_uplift_pct": 4,
    "reference_source": "placeholder",
    "reference_by_sku": {},
    "override_uplift_pct": None,
    "voucher": False,
    "voucher_uplift_pct": 3,
    "voucher_by_sku": {},
    "explanation": None,
    "start_month": "2026-11-01",
    "end_month": "2026-12-01",
    "start_date": None,
    "end_date": None,
    "is_active": True,
}

SAVED = {**BODY, "promotion_id": 1, "sku": "SKU-A"}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


def _no_service_call(*args, **kwargs):
    raise AssertionError("the service should not be called")


# ---- List --------------------------------------------------------------------


def test_list_returns_the_service_rows(monkeypatch):
    monkeypatch.setattr(promotions_service, "list_scenario_promotions", lambda: [SAVED])

    response = client.get("/api/scenario/promotions")

    assert response.status_code == 200
    assert response.json() == [SAVED]


def test_list_with_the_database_down_is_503(monkeypatch):
    monkeypatch.setattr(
        promotions_service,
        "list_scenario_promotions",
        _raises(OperationalError("SELECT", {}, Exception("down"))),
    )

    assert client.get("/api/scenario/promotions").status_code == 503


# ---- Create ------------------------------------------------------------------


def test_create_is_201(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", lambda promotion: SAVED)

    response = client.post("/api/scenario/promotions", json=BODY)

    assert response.status_code == 201
    assert response.json() == SAVED


def test_create_with_months_out_of_order_is_422_without_calling_the_service(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    response = client.post("/api/scenario/promotions", json={**BODY, "start_month": "2027-01-01"})

    assert response.status_code == 422


def test_create_without_a_product_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    response = client.post("/api/scenario/promotions", json={**BODY, "product_name": None})

    assert response.status_code == 422


def test_create_with_an_unknown_promo_type_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    response = client.post("/api/scenario/promotions", json={**BODY, "promo_type": "flash"})

    assert response.status_code == 422


def test_create_with_an_override_out_of_range_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    response = client.post("/api/scenario/promotions", json={**BODY, "override_uplift_pct": 500})

    assert response.status_code == 422


def test_create_with_dates_on_a_monthly_promotion_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    body = {**BODY, "promo_type": "monthly", "start_date": "2026-11-03", "end_date": "2026-12-09"}
    response = client.post("/api/scenario/promotions", json=body)

    assert response.status_code == 422


def test_create_a_side_offer_with_dates_outside_its_months_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    body = {**BODY, "promo_type": "side_offer", "start_date": "2026-10-28", "end_date": "2026-12-09"}
    response = client.post("/api/scenario/promotions", json=body)

    assert response.status_code == 422


def test_create_a_side_offer_with_only_a_start_date_is_422(monkeypatch):
    monkeypatch.setattr(promotions_service, "create_scenario_promotion", _no_service_call)

    body = {**BODY, "promo_type": "side_offer", "start_date": "2026-11-03"}
    response = client.post("/api/scenario/promotions", json=body)

    assert response.status_code == 422


def test_create_with_an_unknown_customer_is_400(monkeypatch):
    monkeypatch.setattr(
        promotions_service, "create_scenario_promotion", _raises(ValueError("Unknown customer: x"))
    )

    response = client.post("/api/scenario/promotions", json=BODY)

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown customer: x"


def test_create_racing_a_deleted_customer_is_409(monkeypatch):
    monkeypatch.setattr(
        promotions_service,
        "create_scenario_promotion",
        _raises(IntegrityError("INSERT", {}, Exception("fk"))),
    )

    assert client.post("/api/scenario/promotions", json=BODY).status_code == 409


# ---- Update and delete -------------------------------------------------------


def test_update_of_a_missing_promotion_is_404(monkeypatch):
    monkeypatch.setattr(promotions_service, "update_scenario_promotion", lambda pid, promotion: None)

    response = client.put("/api/scenario/promotions/9", json=BODY)

    assert response.status_code == 404
    assert response.json()["detail"] == "Scenario promotion not found"


def test_delete_returns_deleted_true(monkeypatch):
    monkeypatch.setattr(promotions_service, "delete_scenario_promotion", lambda pid: True)

    response = client.delete("/api/scenario/promotions/1")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}


def test_delete_of_a_missing_promotion_is_404(monkeypatch):
    monkeypatch.setattr(promotions_service, "delete_scenario_promotion", lambda pid: False)

    assert client.delete("/api/scenario/promotions/1").status_code == 404
