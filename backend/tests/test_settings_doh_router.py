from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.settings import common
from app.services.settings import doh as doh_service

client = TestClient(app)

THRESHOLDS = {"min_doh": 25, "target_doh": 30, "max_doh": 35}

SETTINGS = {
    "customer_id": 1,
    "customer_name": "fairprice",
    "doh_alert_enabled": True,
    "doh_alert_updated_at": "2026-09-26T08:00:00+00:00",
    "setting_id": 4,
    "min_doh": Decimal("25.00"),
    "target_doh": Decimal("30.50"),
    "max_doh": Decimal("35.00"),
    "thresholds_updated_at": "2026-09-26T09:00:00+00:00",
    "thresholds_updated_by": None,
}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


def _not_found(*args, **kwargs):
    raise common.CustomerNotFoundError("Customer 9 does not exist.")


# ---- saving thresholds ----------------------------------------------------------


def test_a_new_threshold_version_is_201(monkeypatch):
    seen = {}

    def fake(customer_id, min_doh, target_doh, max_doh, updated_by):
        seen.update(customer_id=customer_id, values=(min_doh, target_doh, max_doh), updated_by=updated_by)
        return {"changed": True, "settings": SETTINGS}

    monkeypatch.setattr(doh_service, "save_thresholds", fake)

    response = client.put(
        "/api/settings/doh/1/thresholds",
        json={"min_doh": 25, "target_doh": 30.5, "max_doh": "35.00", "updated_by": "ops@aire"},
    )

    assert response.status_code == 201
    assert response.json()["changed"] is True
    assert seen == {
        "customer_id": 1,
        "values": (Decimal("25"), Decimal("30.5"), Decimal("35.00")),
        "updated_by": "ops@aire",
    }
    assert all(isinstance(value, Decimal) for value in seen["values"])


def test_unchanged_thresholds_are_200_with_changed_false(monkeypatch):
    monkeypatch.setattr(
        doh_service,
        "save_thresholds",
        lambda *args: {"changed": False, "settings": SETTINGS},
    )

    response = client.put("/api/settings/doh/1/thresholds", json=THRESHOLDS)

    assert response.status_code == 200
    assert response.json()["changed"] is False


def test_threshold_values_come_back_as_json_numbers(monkeypatch):
    monkeypatch.setattr(doh_service, "get_settings", lambda customer_id: SETTINGS)

    body = client.get("/api/settings/doh/1").json()

    assert (body["min_doh"], body["target_doh"], body["max_doh"]) == (25, 30.5, 35)


def test_updated_by_is_optional(monkeypatch):
    seen = {}

    def fake(customer_id, min_doh, target_doh, max_doh, updated_by):
        seen["updated_by"] = updated_by
        return {"changed": True, "settings": SETTINGS}

    monkeypatch.setattr(doh_service, "save_thresholds", fake)

    assert client.put("/api/settings/doh/1/thresholds", json=THRESHOLDS).status_code == 201
    assert seen["updated_by"] is None


@pytest.mark.parametrize(
    "change",
    [
        {"min_doh": 31},
        {"max_doh": 29},
        {"min_doh": -1},
        {"min_doh": 25.123},
        {"max_doh": 10000},
        {"target_doh": "abc"},
        {"target_doh": None},
        {"updated_by": "   "},
    ],
    ids=[
        "min_above_target",
        "target_above_max",
        "negative",
        "more_than_2_decimal_places",
        "too_large_for_numeric_6_2",
        "not_a_number",
        "missing_value",
        "blank_updated_by",
    ],
)
def test_invalid_thresholds_are_422_before_reaching_the_service(monkeypatch, change):
    monkeypatch.setattr(doh_service, "save_thresholds", _raises(AssertionError("service was called")))

    response = client.put("/api/settings/doh/1/thresholds", json={**THRESHOLDS, **change})

    assert response.status_code == 422


def test_min_equal_to_target_equal_to_max_is_allowed(monkeypatch):
    monkeypatch.setattr(
        doh_service,
        "save_thresholds",
        lambda *args: {"changed": True, "settings": SETTINGS},
    )

    response = client.put("/api/settings/doh/1/thresholds", json={"min_doh": 30, "target_doh": 30, "max_doh": 30})

    assert response.status_code == 201


# ---- revert ----------------------------------------------------------------------


def test_revert_is_201_and_needs_no_body(monkeypatch):
    seen = {}

    def fake(customer_id, setting_id, updated_by):
        seen.update(customer_id=customer_id, setting_id=setting_id, updated_by=updated_by)
        return {"changed": True, "settings": SETTINGS}

    monkeypatch.setattr(doh_service, "revert_to_version", fake)

    response = client.post("/api/settings/doh/1/history/3/revert")

    assert response.status_code == 201
    assert seen == {"customer_id": 1, "setting_id": 3, "updated_by": None}


def test_revert_to_the_current_values_is_200(monkeypatch):
    monkeypatch.setattr(
        doh_service,
        "revert_to_version",
        lambda *args: {"changed": False, "settings": SETTINGS},
    )

    response = client.post("/api/settings/doh/1/history/4/revert", json={"updated_by": "ops@aire"})

    assert response.status_code == 200


def test_revert_to_a_version_of_another_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        doh_service,
        "revert_to_version",
        _raises(doh_service.SettingVersionNotFoundError("Setting version 3 does not exist for customer 1.")),
    )

    response = client.post("/api/settings/doh/1/history/3/revert")

    assert response.status_code == 404
    assert "Setting version 3" in response.json()["detail"]


# ---- reset to global default -------------------------------------------------------


def test_reset_is_201_when_a_version_is_saved_and_needs_no_body(monkeypatch):
    seen = {}

    def fake(customer_id, updated_by):
        seen.update(customer_id=customer_id, updated_by=updated_by)
        return {"changed": True, "settings": SETTINGS}

    monkeypatch.setattr(doh_service, "reset_to_default", fake)

    response = client.post("/api/settings/doh/1/reset")

    assert response.status_code == 201
    assert seen == {"customer_id": 1, "updated_by": None}


def test_reset_of_a_customer_already_on_the_default_is_200(monkeypatch):
    monkeypatch.setattr(
        doh_service,
        "reset_to_default",
        lambda *args: {"changed": False, "settings": SETTINGS},
    )

    response = client.post("/api/settings/doh/1/reset", json={"updated_by": "ops@aire"})

    assert response.status_code == 200
    assert response.json()["changed"] is False


# ---- alert and history -------------------------------------------------------------


def test_alert_passes_the_flag_and_is_200(monkeypatch):
    seen = {}

    def fake(customer_id, enabled):
        seen.update(customer_id=customer_id, enabled=enabled)
        return {"changed": True, "settings": SETTINGS}

    monkeypatch.setattr(doh_service, "set_alert", fake)

    response = client.put("/api/settings/doh/1/alert", json={"doh_alert_enabled": False})

    assert response.status_code == 200
    assert seen == {"customer_id": 1, "enabled": False}


def test_alert_needs_the_flag(monkeypatch):
    monkeypatch.setattr(doh_service, "set_alert", _raises(AssertionError("service was called")))

    assert client.put("/api/settings/doh/1/alert", json={}).status_code == 422


def test_history_passes_paging_to_the_service(monkeypatch):
    seen = {}

    def fake(customer_id, limit, offset):
        seen.update(customer_id=customer_id, limit=limit, offset=offset)
        return {"customer_id": customer_id, "total": 0, "limit": limit, "offset": offset, "items": []}

    monkeypatch.setattr(doh_service, "get_history", fake)

    assert client.get("/api/settings/doh/1/history?limit=5&offset=10").status_code == 200
    assert seen == {"customer_id": 1, "limit": 5, "offset": 10}


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_history_paging_out_of_range_is_422(monkeypatch, query):
    monkeypatch.setattr(doh_service, "get_history", _raises(AssertionError("service was called")))

    assert client.get(f"/api/settings/doh/1/history?{query}").status_code == 422


# ---- status mapping ----------------------------------------------------------------


@pytest.mark.parametrize(
    "method, url, body, function_name",
    [
        ("get", "/api/settings/doh/9", None, "get_settings"),
        ("put", "/api/settings/doh/9/thresholds", THRESHOLDS, "save_thresholds"),
        ("put", "/api/settings/doh/9/alert", {"doh_alert_enabled": False}, "set_alert"),
        ("get", "/api/settings/doh/9/history", None, "get_history"),
        ("post", "/api/settings/doh/9/history/1/revert", None, "revert_to_version"),
        ("post", "/api/settings/doh/9/reset", None, "reset_to_default"),
    ],
)
def test_an_unknown_customer_is_404(monkeypatch, method, url, body, function_name):
    monkeypatch.setattr(doh_service, function_name, _not_found)

    response = client.request(method, url, json=body)

    assert response.status_code == 404
    assert response.json()["detail"] == "Customer 9 does not exist."


def test_an_unexpected_failure_is_a_500_that_names_the_cause(monkeypatch):
    monkeypatch.setattr(doh_service, "list_settings", _raises(RuntimeError("db down")))

    response = client.get("/api/settings/doh")

    assert response.status_code == 500
    assert "RuntimeError: db down" in response.json()["detail"]
