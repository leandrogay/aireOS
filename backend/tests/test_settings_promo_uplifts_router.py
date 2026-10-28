import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.settings import common
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


def test_updated_by_is_passed_through(monkeypatch):
    seen = {}

    def fake(setting_id, uplift_pct, note=None, updated_by=None):
        seen.update(setting_id=setting_id, note=note, updated_by=updated_by)
        return {"changed": True, "setting": SETTING}

    monkeypatch.setattr(service, "update_uplift", fake)

    client.put(f"{BASE}/8", json={"uplift_pct": 6, "note": "  seen in July  ", "updated_by": "aireos"})

    assert seen == {"setting_id": 8, "note": "seen in July", "updated_by": "aireos"}


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


def test_setting_an_anchor_is_201_and_passes_the_customer(monkeypatch):
    seen = {}

    def fake(customer_id, anchor_pct, updated_by):
        seen.update(customer_id=customer_id, anchor_pct=float(anchor_pct))
        return {"changed": True, "anchor": ANCHOR}

    monkeypatch.setattr(service, "set_anchor", fake)

    assert client.put(f"{BASE}/anchors/1", json={"anchor_pct": 25}).status_code == 201
    assert seen == {"customer_id": 1, "anchor_pct": 25.0}


def test_the_default_anchor_is_saved_with_no_customer(monkeypatch):
    seen = {}

    def fake(customer_id, anchor_pct, updated_by):
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
    for name in ("get_anchor", "set_anchor", "reset_anchor", "anchor_history"):
        monkeypatch.setattr(service, name, not_found)

    assert client.get(f"{BASE}/anchors/9").status_code == 404
    assert client.put(f"{BASE}/anchors/9", json={"anchor_pct": 25}).status_code == 404
    assert client.post(f"{BASE}/anchors/9/reset").status_code == 404
    assert client.get(f"{BASE}/anchors/9/history").status_code == 404


def test_resetting_an_anchor_already_on_the_suggestion_is_200(monkeypatch):
    monkeypatch.setattr(service, "reset_anchor", lambda *a, **k: {"changed": False, "anchor": ANCHOR})

    assert client.post(f"{BASE}/anchors/1/reset").status_code == 200


# ---- measurement, notes, archive and new mechanics ------------------------------------

from google.auth.exceptions import DefaultCredentialsError  # noqa: E402

from app.services.settings import promo_measurement as measurement  # noqa: E402


@pytest.mark.parametrize(
    "error, status",
    [
        (None, 200),
        (measurement.MeasurementRunningError("busy"), 409),
        (ValueError("no rows"), 400),
        (DefaultCredentialsError("no creds"), 503),
        (RuntimeError("boom"), 500),
    ],
)
def test_measure_maps_each_outcome(monkeypatch, error, status):
    monkeypatch.setattr(
        measurement, "run_measurement",
        _raises(error) if error else (lambda trigger: {"run_id": 1, "status": "succeeded", "trigger": trigger}),
    )

    response = client.post(f"{BASE}/measure")

    assert response.status_code == status
    if status == 200:
        assert response.json()["trigger"] == "button"


def test_measure_status_and_notes_are_200(monkeypatch):
    monkeypatch.setattr(measurement, "measurement_status", lambda: {"stale": False})
    monkeypatch.setattr(measurement, "list_notes", lambda: [])

    assert client.get(f"{BASE}/measure/status").json() == {"stale": False}
    assert client.get(f"{BASE}/notes").json() == []


@pytest.mark.parametrize(
    "error, status",
    [
        (None, 200),
        (measurement.NoteNotFoundError("gone"), 404),
        (measurement.NoteConflictError("done"), 409),
    ],
)
def test_note_decisions_map_each_outcome(monkeypatch, error, status):
    for name in ("use_measured", "keep_mine"):
        monkeypatch.setattr(measurement, name, _raises(error) if error else (lambda note_id, by: {"changed": True}))

    for action in ("use-measured", "keep-mine"):
        assert client.post(f"{BASE}/notes/5/{action}").status_code == status


def test_archive_and_restore_are_201_when_a_version_is_written(monkeypatch):
    monkeypatch.setattr(service, "archive_uplift", lambda setting_id, by: {"changed": True, "setting": SETTING})
    monkeypatch.setattr(service, "restore_uplift", lambda setting_id, by: {"changed": False, "setting": SETTING})

    assert client.post(f"{BASE}/8/archive").status_code == 201
    assert client.post(f"{BASE}/8/restore").status_code == 200


def test_archive_of_a_missing_row_is_404(monkeypatch):
    monkeypatch.setattr(service, "archive_uplift", _raises(service.UpliftSettingNotFoundError("missing")))

    assert client.post(f"{BASE}/8/archive").status_code == 404


def test_evidence_is_200_and_404_when_missing(monkeypatch):
    monkeypatch.setattr(measurement, "evidence", lambda setting_id: {"setting_id": setting_id, "result": None})
    assert client.get(f"{BASE}/8/evidence").json() == {"setting_id": 8, "result": None}

    monkeypatch.setattr(measurement, "evidence", _raises(service.UpliftSettingNotFoundError("missing")))
    assert client.get(f"{BASE}/8/evidence").status_code == 404


def test_a_new_mechanic_is_201_and_an_unreadable_label_is_422(monkeypatch):
    monkeypatch.setattr(service, "add_mechanic", lambda *args, **kwargs: {"changed": True, "setting": SETTING})

    assert client.post(f"{BASE}/mechanics", json={"mechanic_label": "35% Off"}).status_code == 201
    assert client.post(f"{BASE}/mechanics", json={"mechanic_label": "Free tote bag"}).status_code == 422
    assert client.post(f"{BASE}/mechanics", json={"kind": "voucher", "mechanic_label": "$5 off $50"}).status_code == 422


def test_a_duplicate_mechanic_is_409(monkeypatch):
    monkeypatch.setattr(service, "add_mechanic", _raises(service.UpliftSettingConflictError("exists")))

    assert client.post(f"{BASE}/mechanics", json={"mechanic_label": "30% Off"}).status_code == 409


# ---- the rule ------------------------------------------------------------------------


def test_get_rule_is_200(monkeypatch):
    monkeypatch.setattr(service, "get_rule", lambda: {"uplift_per_point_pct": 0.4, "history": []})

    assert client.get(f"{BASE}/rule").json()["uplift_per_point_pct"] == 0.4


def test_put_rule_is_201_with_the_warning_and_200_when_unchanged(monkeypatch):
    def fake(rate, by):
        changed = float(rate) != 0.4
        warning = "much higher" if rate > 1 else None
        return {"changed": changed, "rule": {"uplift_per_point_pct": float(rate)}, "warning": warning}

    monkeypatch.setattr(service, "set_rule", fake)

    high = client.put(f"{BASE}/rule", json={"uplift_per_point_pct": 4})
    same = client.put(f"{BASE}/rule", json={"uplift_per_point_pct": 0.4})

    assert high.status_code == 201
    assert high.json()["warning"] == "much higher"
    assert same.status_code == 200


@pytest.mark.parametrize("rate", [0, -0.5])
def test_a_rate_of_zero_or_below_is_422_with_a_plain_message(rate):
    response = client.put(f"{BASE}/rule", json={"uplift_per_point_pct": rate})

    assert response.status_code == 422
    assert "more than 0% per point" in response.text


def test_reset_rule_is_201_or_200(monkeypatch):
    monkeypatch.setattr(service, "reset_rule", lambda by: {"changed": True, "rule": {}, "warning": None})
    assert client.post(f"{BASE}/rule/reset").status_code == 201
