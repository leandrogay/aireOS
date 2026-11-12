import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.settings import common
from app.services.settings import promo_moments as moment_service
from app.services.settings import promo_uplift_calc as calc_service
from app.services.settings import promo_uplifts as service

client = TestClient(app)

BASE = "/api/settings/promo-uplifts"
SETTING = {"id": 8, "mechanic_key": "pct_off_30", "effective_discount_pct": 25.0, "source": "placeholder"}
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

    def fake(customer, product, sku_range):
        seen.update(customer=customer, product=product, sku_range=sku_range)
        return {"uplifts": []}

    monkeypatch.setattr(service, "resolve_uplifts", fake)

    response = client.get(f"{BASE}/resolved", params={"customer": "fairprice", "product": "Aire Pants L"})

    assert response.status_code == 200
    assert seen == {"customer": "fairprice", "product": "Aire Pants L", "sku_range": None}


def test_resolved_passes_the_sku_range(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        service, "resolve_uplifts", lambda customer, product, sku_range: seen.update(sku_range=sku_range) or {}
    )

    client.get(f"{BASE}/resolved", params={"customer": "fairprice", "sku_range": "Ultra Tape"})

    assert seen == {"sku_range": "Ultra Tape"}


def test_resolved_without_a_product_means_all_skus(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        service, "resolve_uplifts", lambda customer, product, sku_range: seen.update(product=product) or {}
    )

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


# ---- calculated uplifts --------------------------------------------------------


def test_calculated_uplifts_pass_the_customer(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        calc_service, "list_calculated", lambda customer_id: seen.update(customer_id=customer_id) or {"rows": []}
    )

    response = client.get(f"{BASE}/calculated", params={"customer_id": 1})

    assert response.status_code == 200
    assert seen == {"customer_id": 1}


def test_calculated_uplifts_for_an_unknown_customer_are_404(monkeypatch):
    monkeypatch.setattr(calc_service, "list_calculated", _raises(common.CustomerNotFoundError("Customer 9 does not exist.")))

    assert client.get(f"{BASE}/calculated", params={"customer_id": 9}).status_code == 404


# ---- mechanic discounts --------------------------------------------------------


def test_a_new_discount_is_201_and_unchanged_is_200(monkeypatch):
    monkeypatch.setattr(service, "set_mechanic_discount", lambda *a, **k: {"changed": True, "setting": SETTING})
    assert client.put(f"{BASE}/mechanics/pct_off_30", json={"effective_discount_pct": 25}).status_code == 201

    monkeypatch.setattr(service, "set_mechanic_discount", lambda *a, **k: {"changed": False, "setting": SETTING})
    assert client.put(f"{BASE}/mechanics/pct_off_30", json={"effective_discount_pct": 25}).status_code == 200


def test_the_signed_in_user_is_recorded_not_a_name_in_the_body(monkeypatch, signed_in):
    seen = {}

    def fake(mechanic_key, discount_pct, note=None, updated_by=None):
        seen.update(mechanic_key=mechanic_key, note=note, updated_by=updated_by)
        return {"changed": True, "setting": SETTING}

    monkeypatch.setattr(service, "set_mechanic_discount", fake)

    client.put(
        f"{BASE}/mechanics/pct_off_30",
        json={"effective_discount_pct": 25, "note": "  from Dec  ", "updated_by": "someone-else"},
    )

    assert seen == {"mechanic_key": "pct_off_30", "note": "from Dec", "updated_by": signed_in}


@pytest.mark.parametrize("discount", [0, 101, 4.123])
def test_out_of_range_discounts_are_422(discount):
    assert client.put(f"{BASE}/mechanics/pct_off_30", json={"effective_discount_pct": discount}).status_code == 422


def test_a_discount_for_an_unknown_mechanic_is_404(monkeypatch):
    monkeypatch.setattr(service, "set_mechanic_discount", _raises(service.MechanicNotFoundError("Mechanic x does not exist.")))

    assert client.put(f"{BASE}/mechanics/x", json={"effective_discount_pct": 25}).status_code == 404


def test_typed_uplifts_are_gone():
    assert client.put(f"{BASE}/8", json={"uplift_pct": 6}).status_code in (404, 405)
    assert client.post(f"{BASE}/8/reset").status_code in (404, 405)
    assert client.post(BASE, json={"mechanic_key": "pct_off_30", "scope": "customer", "customer_id": 1}).status_code == 405


# ---- anchors -----------------------------------------------------------------------


def test_overwriting_an_anchor_is_201_and_passes_the_customer_and_mechanic(monkeypatch, signed_in):
    seen = {}

    def fake(customer_id, mechanic_key, sku_range, updated_by):
        seen.update(customer_id=customer_id, mechanic_key=mechanic_key, sku_range=sku_range, updated_by=updated_by)
        return {"changed": True, "anchor": ANCHOR}

    monkeypatch.setattr(service, "overwrite_anchor", fake)

    response = client.put(f"{BASE}/anchors/1", json={"mechanic_key": "pct_off_30", "sku_range": "Pants"})

    assert response.status_code == 201
    assert seen == {"customer_id": 1, "mechanic_key": "pct_off_30", "sku_range": "Pants", "updated_by": signed_in}


def test_an_anchor_overwrite_needs_a_mechanic_not_a_percent():
    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25}).status_code == 422


def test_an_overwrite_the_service_refuses_is_400(monkeypatch):
    refused = _raises(ValueError("Add a promotion with this mechanic on the Promotions page first."))
    monkeypatch.setattr(service, "overwrite_anchor", refused)
    monkeypatch.setattr(service, "adopt_anchor", refused)

    response = client.put(f"{BASE}/anchors/1", json={"mechanic_key": "b1g1"})

    assert response.status_code == 400
    assert "Promotions page" in response.json()["detail"]
    assert client.post(f"{BASE}/anchors/1/adopt", json={"sku_range": "Socks"}).status_code == 400


def test_adopting_with_too_few_moments_is_409(monkeypatch):
    monkeypatch.setattr(service, "adopt_anchor", _raises(service.UpliftSettingConflictError("Too few moments")))

    assert client.post(f"{BASE}/anchors/1/adopt").status_code == 409


def test_the_fallback_anchor_is_typed(monkeypatch):
    seen = {}

    def fake(anchor_pct, updated_by):
        seen.update(anchor_pct=float(anchor_pct))
        return {"changed": True, "fallback": {"anchor_pct": 30.0}}

    monkeypatch.setattr(service, "set_fallback_anchor", fake)

    assert client.put(f"{BASE}/anchors/default", json={"anchor_pct": 30}).status_code == 201
    assert seen == {"anchor_pct": 30.0}


@pytest.mark.parametrize("anchor_pct", [-1, 101])
def test_fallback_anchors_outside_0_to_100_are_422(anchor_pct):
    assert client.put(f"{BASE}/anchors/default", json={"anchor_pct": anchor_pct}).status_code == 422


def test_the_fallbacks_history_has_no_customer(monkeypatch):
    seen = {}
    monkeypatch.setattr(service, "anchor_history", lambda customer_id, sku_range=None: seen.update(customer_id=customer_id) or [])

    assert client.get(f"{BASE}/anchors/default/history").status_code == 200
    assert seen == {"customer_id": None}


def test_anchor_endpoints_for_an_unknown_customer_are_404(monkeypatch):
    not_found = _raises(common.CustomerNotFoundError("Customer 9 does not exist."))
    for name in ("get_anchor", "overwrite_anchor", "adopt_anchor", "anchor_history"):
        monkeypatch.setattr(service, name, not_found)

    assert client.get(f"{BASE}/anchors/9").status_code == 404
    assert client.put(f"{BASE}/anchors/9", json={"mechanic_key": "pct_off_30"}).status_code == 404
    assert client.post(f"{BASE}/anchors/9/adopt").status_code == 404
    assert client.get(f"{BASE}/anchors/9/history").status_code == 404


@pytest.mark.parametrize(
    "service_name, method, path, body",
    [
        ("set_mechanic_discount", "put", "/mechanics/pct_off_30", {"effective_discount_pct": 25}),
        ("set_fallback_anchor", "put", "/anchors/default", {"anchor_pct": 30}),
        ("overwrite_anchor", "put", "/anchors/1", {"mechanic_key": "pct_off_30"}),
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


# ---- recalculate -------------------------------------------------------------------


def test_recalculate_runs_for_one_customer_and_is_200(monkeypatch):
    from app.services.settings import promo_recalc

    seen = []
    monkeypatch.setattr(promo_recalc, "recalculate", lambda customer_id: seen.append(customer_id) or {"customers": [], "failed": []})

    response = client.post(f"{BASE}/recalculate", params={"customer_id": 3})

    assert response.status_code == 200
    assert seen == [3]


def test_recalculate_for_an_unknown_customer_is_404(monkeypatch):
    from app.services.settings import promo_recalc

    monkeypatch.setattr(promo_recalc, "recalculate", _raises(common.CustomerNotFoundError("Customer 3 does not exist.")))

    response = client.post(f"{BASE}/recalculate", params={"customer_id": 3})

    assert response.status_code == 404
    assert response.json()["detail"] == "Customer 3 does not exist."
