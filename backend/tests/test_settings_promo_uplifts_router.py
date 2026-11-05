import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.settings import common
from app.services.settings import promo_moments as moment_service
from app.services.settings import promo_uplifts as service

client = TestClient(app)

BASE = "/api/settings/promo-uplifts"
SETTING = {"id": 8, "mechanic_key": "pct_off_30", "uplift_pct": 6.0, "source": "estimate"}
ANCHOR = {"customer_id": 1, "customer_name": "fairprice", "anchor_pct": 25.0, "source": "manual"}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


# ---- reads -------------------------------------------------------------------------


def test_list_settings_is_200(monkeypatch):
    body = {"settings": [SETTING], "default_anchor_pct": 20.0, "unmapped_mechanics": []}
    monkeypatch.setattr(service, "list_settings", lambda: body)

    response = client.get(BASE)

    assert response.status_code == 200
    assert response.json() == body


def test_resolved_passes_customer_and_product(monkeypatch):
    seen = {}

    def fake(customer, product):
        seen.update(customer=customer, product=product)
        return {"uplifts": []}

    monkeypatch.setattr(service, "resolve_uplifts", fake)

    response = client.get(f"{BASE}/resolved", params={"customer": "fairprice", "product": "Aire Pants L"})

    assert response.status_code == 200
    assert seen == {"customer": "fairprice", "product": "Aire Pants L"}


def test_resolved_without_a_product_means_all_skus(monkeypatch):
    seen = {}
    monkeypatch.setattr(service, "resolve_uplifts", lambda customer, product: seen.update(product=product) or {})

    client.get(f"{BASE}/resolved", params={"customer": "fairprice", "product": ""})

    assert seen == {"product": None}


def test_resolved_for_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(service, "resolve_uplifts", _raises(common.CustomerNotFoundError("Customer nobody does not exist.")))

    response = client.get(f"{BASE}/resolved", params={"customer": "nobody"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Customer nobody does not exist."


def test_resolved_needs_a_customer():
    assert client.get(f"{BASE}/resolved").status_code == 422


def test_unknown_mechanic_history_is_404(monkeypatch):
    monkeypatch.setattr(service, "mechanic_history", _raises(service.MechanicNotFoundError("Mechanic x does not exist.")))

    assert client.get(f"{BASE}/mechanics/x/history").status_code == 404


def test_an_unexpected_error_is_500_with_the_reason(monkeypatch):
    monkeypatch.setattr(service, "list_anchors", _raises(RuntimeError("db down")))

    response = client.get(f"{BASE}/anchors")

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to retrieve the ordinary-month discounts: RuntimeError: db down"


# ---- editing uplifts ---------------------------------------------------------------


def test_a_new_uplift_version_is_201_and_unchanged_is_200(monkeypatch):
    monkeypatch.setattr(service, "update_uplift", lambda *a, **k: {"changed": True, "setting": SETTING})
    assert client.put(f"{BASE}/8", json={"uplift_pct": 6}).status_code == 201

    monkeypatch.setattr(service, "update_uplift", lambda *a, **k: {"changed": False, "setting": SETTING})
    assert client.put(f"{BASE}/8", json={"uplift_pct": 6}).status_code == 200


def test_the_signed_in_user_is_recorded_not_a_name_in_the_body(monkeypatch, signed_in):
    seen = {}

    def fake(setting_id, uplift_pct, note=None, updated_by=None):
        seen.update(setting_id=setting_id, note=note, updated_by=updated_by)
        return {"changed": True, "setting": SETTING}

    monkeypatch.setattr(service, "update_uplift", fake)

    client.put(f"{BASE}/8", json={"uplift_pct": 6, "note": "  seen in July  ", "updated_by": "someone-else"})

    assert seen == {"setting_id": 8, "note": "seen in July", "updated_by": signed_in}


@pytest.mark.parametrize("uplift_pct", [-91, 301, 4.123])
def test_out_of_range_uplifts_are_422(uplift_pct):
    assert client.put(f"{BASE}/8", json={"uplift_pct": uplift_pct}).status_code == 422


@pytest.mark.parametrize(
    "exc, status",
    [
        (service.UpliftSettingNotFoundError("Uplift setting 8 does not exist."), 404),
        (service.UpliftSettingConflictError("Learned values cannot be edited."), 409),
    ],
)
def test_uplift_write_errors_map_to_status_codes(monkeypatch, exc, status):
    monkeypatch.setattr(service, "update_uplift", _raises(exc))
    monkeypatch.setattr(service, "reset_uplift", _raises(exc))

    assert client.put(f"{BASE}/8", json={"uplift_pct": 6}).status_code == status
    assert client.post(f"{BASE}/8/reset").status_code == status


# ---- overrides ---------------------------------------------------------------------


def test_an_override_is_201(monkeypatch):
    monkeypatch.setattr(service, "add_override", lambda *a, **k: {"changed": True, "setting": SETTING})

    response = client.post(BASE, json={"mechanic_key": "pct_off_30", "scope": "sku", "customer_id": 1, "sku": "SKU-L", "uplift_pct": 7})

    assert response.status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"mechanic_key": "pct_off_30", "scope": "all", "customer_id": 1, "uplift_pct": 7},
        {"mechanic_key": "pct_off_30", "scope": "sku", "customer_id": 1, "uplift_pct": 7},
        {"mechanic_key": "pct_off_30", "scope": "range", "customer_id": 1, "sku": "SKU-L", "uplift_pct": 7},
        {"mechanic_key": "pct_off_30", "scope": "customer", "customer_id": 1, "sku": "SKU-L", "uplift_pct": 7},
    ],
)
def test_overrides_with_the_wrong_scope_columns_are_422(body):
    assert client.post(BASE, json=body).status_code == 422


def test_a_duplicate_override_is_409(monkeypatch):
    monkeypatch.setattr(service, "add_override", _raises(service.UpliftSettingConflictError("already has a value")))

    response = client.post(BASE, json={"mechanic_key": "pct_off_30", "scope": "customer", "customer_id": 1, "uplift_pct": 7})

    assert response.status_code == 409


# ---- anchors -----------------------------------------------------------------------


def test_setting_an_anchor_is_201_and_passes_the_customer(monkeypatch, signed_in):
    seen = {}

    def fake(customer_id, anchor_pct, sku_range, updated_by):
        seen.update(customer_id=customer_id, anchor_pct=float(anchor_pct), sku_range=sku_range, updated_by=updated_by)
        return {"changed": True, "anchor": ANCHOR}

    monkeypatch.setattr(service, "set_anchor", fake)

    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25}).status_code == 201
    assert seen == {"customer_id": 1, "anchor_pct": 25.0, "sku_range": None, "updated_by": signed_in}


def test_a_range_anchor_passes_its_range(monkeypatch):
    seen = {}

    def fake(customer_id, anchor_pct, sku_range, updated_by):
        seen.update(customer_id=customer_id, sku_range=sku_range)
        return {"changed": True, "anchor": ANCHOR}

    monkeypatch.setattr(service, "set_anchor", fake)

    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25, "sku_range": "Pants"}).status_code == 201
    assert seen == {"customer_id": 1, "sku_range": "Pants"}


def test_an_unknown_range_anchor_is_400(monkeypatch):
    bad_range = _raises(ValueError("SKU range Socks is not in the catalogue."))
    monkeypatch.setattr(service, "set_anchor", bad_range)
    monkeypatch.setattr(service, "adopt_anchor", bad_range)

    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25, "sku_range": "Socks"}).status_code == 400
    assert client.post(f"{BASE}/anchors/1/adopt", json={"sku_range": "Socks"}).status_code == 400


def test_typing_an_anchor_the_data_can_recommend_is_409(monkeypatch):
    blocked = _raises(service.UpliftSettingConflictError("adopt the recommended anchor instead"))
    monkeypatch.setattr(service, "set_anchor", blocked)
    monkeypatch.setattr(service, "adopt_anchor", blocked)

    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25}).status_code == 409
    assert client.post(f"{BASE}/anchors/1/adopt").status_code == 409


def test_the_default_anchor_is_saved_with_no_customer(monkeypatch):
    seen = {}

    def fake(customer_id, anchor_pct, sku_range, updated_by):
        seen.update(customer_id=customer_id)
        return {"changed": True, "default_anchor_pct": 30.0}

    monkeypatch.setattr(service, "set_anchor", fake)

    assert client.put(f"{BASE}/anchors/default", json={"anchor_pct": 30}).status_code == 201
    assert seen == {"customer_id": None}


@pytest.mark.parametrize("anchor_pct", [-1, 101])
def test_anchors_outside_0_to_100_are_422(anchor_pct):
    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": anchor_pct}).status_code == 422


def test_anchor_endpoints_for_an_unknown_customer_are_404(monkeypatch):
    not_found = _raises(common.CustomerNotFoundError("Customer 9 does not exist."))
    for name in ("get_anchor", "set_anchor", "adopt_anchor", "anchor_history"):
        monkeypatch.setattr(service, name, not_found)

    assert client.get(f"{BASE}/anchors/9").status_code == 404
    assert client.put(f"{BASE}/anchors/9", json={"anchor_pct": 25}).status_code == 404
    assert client.post(f"{BASE}/anchors/9/adopt").status_code == 404
    assert client.get(f"{BASE}/anchors/9/history").status_code == 404


@pytest.mark.parametrize(
    "service_name, method, path, body",
    [
        ("add_override", "post", "", {"mechanic_key": "pct_off_30", "scope": "customer", "customer_id": 1, "uplift_pct": 7}),
        ("reset_uplift", "post", "/8/reset", None),
        ("set_anchor", "put", "/anchors/default", {"anchor_pct": 30}),
        ("adopt_anchor", "post", "/anchors/1/adopt", {"sku_range": "Pants"}),
    ],
)
def test_every_write_records_the_signed_in_user(monkeypatch, signed_in, service_name, method, path, body):
    seen = {}

    def fake(*args, **kwargs):
        seen["updated_by"] = kwargs.get("updated_by", args[-1])
        return {"changed": True, "setting": SETTING, "anchor": ANCHOR}

    monkeypatch.setattr(service, service_name, fake)

    client.request(method, f"{BASE}{path}", json=body)

    assert seen == {"updated_by": signed_in}


def test_adopting_an_anchor_already_adopted_is_200(monkeypatch):
    monkeypatch.setattr(service, "adopt_anchor", lambda *a, **k: {"changed": False, "anchor": ANCHOR})

    assert client.post(f"{BASE}/anchors/1/adopt").status_code == 200


# ---- moments -----------------------------------------------------------------------


def test_list_moments_is_200(monkeypatch):
    body = {"baseline_method": "common_discount", "recommend_from": 3, "moments": [], "recommendations": []}
    monkeypatch.setattr(moment_service, "list_moments", lambda: body)

    response = client.get(f"{BASE}/moments")

    assert response.status_code == 200
    assert response.json() == body


def test_list_moments_failure_is_500(monkeypatch):
    monkeypatch.setattr(moment_service, "list_moments", _raises(RuntimeError("db down")))

    response = client.get(f"{BASE}/moments")

    assert response.status_code == 500
    assert "Failed to retrieve promotion moments" in response.json()["detail"]
