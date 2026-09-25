from datetime import date

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import ServiceUnavailable
from google.auth.exceptions import DefaultCredentialsError

from app.main import app
from app.services import inventory_service

client = TestClient(app)

RECORD = {"customer_ids": [1], "sku": "A1", "month": "2026-08-01", "sell_in": 100}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


# ---- read endpoints ---------------------------------------------------------------


def test_overview_passes_the_filters_to_the_service(monkeypatch):
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return {"customers": [], "monthly": [], "skus": []}

    monkeypatch.setattr(inventory_service, "get_overview", fake)

    response = client.get(
        "/api/inventory/overview?customer_id=1&sku=A1&sku=B2&start_month=2026-03-15&end_month=2026-05-20"
    )

    assert response.status_code == 200
    assert seen == {
        "customer_ids": [1],
        "skus": ["A1", "B2"],
        "start_month": date(2026, 3, 1),
        "end_month": date(2026, 5, 1),
        "at_risk_only": False,
    }


def test_customer_view_of_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "get_customer_view",
        _raises(inventory_service.CustomerNotFoundError("Customer 9 does not exist.")),
    )

    assert client.get("/api/inventory/customers/9").status_code == 404


def test_customer_view_maps_missing_bigquery_credentials_to_503(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_customer_view", _raises(DefaultCredentialsError("no key")))

    response = client.get("/api/inventory/customers/1")

    assert response.status_code == 503
    assert "credentials" in response.json()["detail"].lower()


def test_customer_view_maps_a_bigquery_outage_to_503(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_customer_view", _raises(ServiceUnavailable("down")))

    response = client.get("/api/inventory/customers/1")

    assert response.status_code == 503
    assert "forecast" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "url, function_name",
    [
        ("/api/inventory/customers", "list_customers"),
        ("/api/inventory/skus", "list_skus"),
        ("/api/inventory/overview", "get_overview"),
        ("/api/inventory/customers/1", "get_customer_view"),
        ("/api/inventory/customers/1/sell-in-plan", "get_sell_in_plan"),
        ("/api/inventory/doh-thresholds", "get_doh_thresholds"),
    ],
)
def test_an_unexpected_failure_is_a_500_that_names_the_cause(monkeypatch, url, function_name):
    monkeypatch.setattr(inventory_service, function_name, _raises(RuntimeError("db down")))

    response = client.get(url)

    assert response.status_code == 500
    assert "RuntimeError: db down" in response.json()["detail"]


def test_sell_in_plan_passes_the_month_count_to_the_service(monkeypatch):
    seen = {}

    def fake(customer_id, months, skus):
        seen.update(customer_id=customer_id, months=months, skus=skus)
        return {"rows": []}

    monkeypatch.setattr(inventory_service, "get_sell_in_plan", fake)

    response = client.get("/api/inventory/customers/1/sell-in-plan?months=3")

    assert response.status_code == 200
    assert seen == {"customer_id": 1, "months": 3, "skus": None}


@pytest.mark.parametrize("months", [0, 13, "abc"])
def test_sell_in_plan_rejects_an_out_of_range_month_count(monkeypatch, months):
    monkeypatch.setattr(inventory_service, "get_sell_in_plan", _raises(AssertionError("service was called")))

    assert client.get(f"/api/inventory/customers/1/sell-in-plan?months={months}").status_code == 422


def test_sell_in_plan_of_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "get_sell_in_plan",
        _raises(inventory_service.CustomerNotFoundError("nope")),
    )

    assert client.get("/api/inventory/customers/9/sell-in-plan").status_code == 404


def test_sell_in_plan_maps_a_bigquery_outage_to_503(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_sell_in_plan", _raises(ServiceUnavailable("down")))

    response = client.get("/api/inventory/customers/1/sell-in-plan")

    assert response.status_code == 503
    assert "forecast" in response.json()["detail"].lower()


# ---- at risk -----------------------------------------------------------------------


def test_at_risk_passes_the_filters_to_the_service(monkeypatch):
    seen = {}

    def fake(customer_ids, risk):
        seen.update(customer_ids=customer_ids, risk=risk)
        return {"items": []}

    monkeypatch.setattr(inventory_service, "get_at_risk", fake)

    response = client.get("/api/inventory/at-risk?customer_id=1&customer_id=2&risk=below_min")

    assert response.status_code == 200
    assert seen == {"customer_ids": [1, 2], "risk": "below_min"}


def test_at_risk_defaults_to_every_customer_and_both_kinds(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        inventory_service, "get_at_risk", lambda customer_ids, risk: seen.update(c=customer_ids, r=risk) or {}
    )

    client.get("/api/inventory/at-risk")

    assert seen == {"c": None, "r": None}


def test_at_risk_with_an_unknown_risk_kind_is_400(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_at_risk", _raises(ValueError("risk must be one of ...")))

    assert client.get("/api/inventory/at-risk?risk=fine").status_code == 400


def test_at_risk_for_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service, "get_at_risk", _raises(inventory_service.CustomerNotFoundError("nope"))
    )

    assert client.get("/api/inventory/at-risk?customer_id=9").status_code == 404


def test_at_risk_maps_a_bigquery_outage_to_503(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_at_risk", _raises(ServiceUnavailable("down")))

    response = client.get("/api/inventory/at-risk")

    assert response.status_code == 503
    assert "forecast" in response.json()["detail"].lower()


def test_overview_at_risk_only_reaches_the_service(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        inventory_service, "get_overview", lambda **kwargs: seen.update(kwargs) or {"skus": []}
    )

    client.get("/api/inventory/overview?at_risk_only=true")

    assert seen["at_risk_only"] is True


def test_overview_maps_a_bigquery_outage_to_503_when_filtering_by_risk(monkeypatch):
    monkeypatch.setattr(inventory_service, "get_overview", _raises(ServiceUnavailable("down")))

    assert client.get("/api/inventory/overview?at_risk_only=true").status_code == 503


# ---- whole-number quantities -------------------------------------------------------


@pytest.mark.parametrize("body", [{"sell_in": 3.5}, {"opening_inventory": 2.5}])
def test_a_record_quantity_with_a_fraction_is_rejected(monkeypatch, body):
    monkeypatch.setattr(inventory_service, "create_records", _raises(AssertionError("service was called")))

    assert client.post("/api/inventory/records", json={**RECORD, **body}).status_code == 422


def test_a_shipped_so_far_quantity_with_a_fraction_is_rejected(monkeypatch):
    monkeypatch.setattr(inventory_service, "set_shipped_so_far", _raises(AssertionError("service was called")))
    body = {"customer_ids": [1], "sku": "A1", "month": "2026-10-01", "shipped_so_far": 1.5}

    assert client.put("/api/inventory/shipped-so-far", json=body).status_code == 422


def test_whole_number_quantities_are_accepted(monkeypatch):
    monkeypatch.setattr(inventory_service, "create_records", lambda record: {"records_written": 1})

    response = client.post("/api/inventory/records", json={**RECORD, "sell_in": 120, "opening_inventory": 0})

    assert response.status_code == 201


# ---- create / edit -----------------------------------------------------------------


def test_create_returns_201_with_the_summary(monkeypatch):
    monkeypatch.setattr(inventory_service, "create_records", lambda record: {"records_written": 3})

    response = client.post("/api/inventory/records", json=RECORD)

    assert response.status_code == 201
    assert response.json() == {"records_written": 3}


def test_create_conflict_is_409(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "create_records",
        _raises(inventory_service.InventoryConflictError("already exists")),
    )

    response = client.post("/api/inventory/records", json=RECORD)

    assert response.status_code == 409
    assert response.json()["detail"] == "already exists"


@pytest.mark.parametrize(
    "error",
    [inventory_service.CustomerNotFoundError("c"), inventory_service.SkuNotFoundError("s")],
)
def test_create_with_an_unknown_customer_or_sku_is_404(monkeypatch, error):
    monkeypatch.setattr(inventory_service, "create_records", _raises(error))

    assert client.post("/api/inventory/records", json=RECORD).status_code == 404


def test_create_with_a_rule_violation_is_400(monkeypatch):
    monkeypatch.setattr(inventory_service, "create_records", _raises(ValueError("first month only")))

    response = client.post("/api/inventory/records", json=RECORD)

    assert response.status_code == 400
    assert response.json()["detail"] == "first month only"


def test_edit_of_a_month_with_no_data_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "update_records",
        _raises(inventory_service.InventoryNotFoundError("none")),
    )

    assert client.put("/api/inventory/records", json=RECORD).status_code == 404


def test_edit_returns_200(monkeypatch):
    monkeypatch.setattr(inventory_service, "update_records", lambda record: {"records_written": 3})

    assert client.put("/api/inventory/records", json=RECORD).status_code == 200


@pytest.mark.parametrize(
    "change",
    [
        {"sell_in": -1},
        {"opening_inventory": -1},
        {"month": "2026-08-15"},
        {"customer_ids": []},
        {"customer_ids": [1, 1]},
        {"customer_ids": [0]},
        {"sku": ""},
    ],
)
def test_invalid_record_input_is_rejected_before_reaching_the_service(monkeypatch, change):
    monkeypatch.setattr(inventory_service, "create_records", _raises(AssertionError("service was called")))

    response = client.post("/api/inventory/records", json={**RECORD, **change})

    assert response.status_code == 422


def test_a_missing_quantity_is_rejected(monkeypatch):
    monkeypatch.setattr(inventory_service, "create_records", _raises(AssertionError("service was called")))
    body = {k: v for k, v in RECORD.items() if k != "sell_in"}

    assert client.post("/api/inventory/records", json=body).status_code == 422


# ---- shipped so far ----------------------------------------------------------------

SHIPPED = {"customer_ids": [1], "sku": "A1", "month": "2026-10-01", "shipped_so_far": 500}


def test_shipped_so_far_returns_200(monkeypatch):
    monkeypatch.setattr(inventory_service, "set_shipped_so_far", lambda update: {"records_written": 1})

    response = client.put("/api/inventory/shipped-so-far", json=SHIPPED)

    assert response.status_code == 200
    assert response.json() == {"records_written": 1}


def test_shipped_so_far_for_a_month_with_actuals_is_400(monkeypatch):
    monkeypatch.setattr(inventory_service, "set_shipped_so_far", _raises(ValueError("already has actual data")))

    response = client.put("/api/inventory/shipped-so-far", json=SHIPPED)

    assert response.status_code == 400
    assert response.json()["detail"] == "already has actual data"


@pytest.mark.parametrize(
    "error",
    [inventory_service.CustomerNotFoundError("c"), inventory_service.SkuNotFoundError("s")],
)
def test_shipped_so_far_for_an_unknown_customer_or_sku_is_404(monkeypatch, error):
    monkeypatch.setattr(inventory_service, "set_shipped_so_far", _raises(error))

    assert client.put("/api/inventory/shipped-so-far", json=SHIPPED).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        {"shipped_so_far": -1},
        {"month": "2026-10-15"},
        {"customer_ids": []},
        {"customer_ids": [1, 1]},
        {"sku": ""},
    ],
)
def test_invalid_shipped_so_far_input_is_rejected_before_reaching_the_service(monkeypatch, change):
    monkeypatch.setattr(inventory_service, "set_shipped_so_far", _raises(AssertionError("service was called")))

    assert client.put("/api/inventory/shipped-so-far", json={**SHIPPED, **change}).status_code == 422


# ---- DOH thresholds ----------------------------------------------------------------


def test_setting_thresholds_passes_customers_and_target(monkeypatch):
    seen = {}

    def fake(customer_ids, target_doh):
        seen.update(customer_ids=customer_ids, target_doh=target_doh)
        return []

    monkeypatch.setattr(inventory_service, "set_doh_thresholds", fake)

    response = client.put("/api/inventory/doh-thresholds", json={"customer_ids": [1, 2], "target_doh": 28})

    assert response.status_code == 200
    assert seen == {"customer_ids": [1, 2], "target_doh": 28}


@pytest.mark.parametrize("target", [0, -5, 2.5, "abc", None])
def test_only_positive_whole_number_targets_are_accepted(monkeypatch, target):
    monkeypatch.setattr(inventory_service, "set_doh_thresholds", _raises(AssertionError("service was called")))

    response = client.put("/api/inventory/doh-thresholds", json={"customer_ids": [1], "target_doh": target})

    assert response.status_code == 422


def test_setting_thresholds_needs_at_least_one_customer(monkeypatch):
    monkeypatch.setattr(inventory_service, "set_doh_thresholds", _raises(AssertionError("service was called")))

    response = client.put("/api/inventory/doh-thresholds", json={"customer_ids": [], "target_doh": 30})

    assert response.status_code == 422


def test_setting_thresholds_for_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "set_doh_thresholds",
        _raises(inventory_service.CustomerNotFoundError("nope")),
    )

    response = client.put("/api/inventory/doh-thresholds", json={"customer_ids": [9], "target_doh": 30})

    assert response.status_code == 404


def test_reset_returns_the_customers_threshold(monkeypatch):
    monkeypatch.setattr(inventory_service, "reset_doh_threshold", lambda customer_id: {"customer_id": customer_id})

    response = client.delete("/api/inventory/doh-thresholds/1")

    assert response.status_code == 200
    assert response.json() == {"customer_id": 1}


def test_reset_for_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "reset_doh_threshold",
        _raises(inventory_service.CustomerNotFoundError("nope")),
    )

    assert client.delete("/api/inventory/doh-thresholds/9").status_code == 404


def test_history_for_an_unknown_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        inventory_service,
        "get_doh_history",
        _raises(inventory_service.CustomerNotFoundError("nope")),
    )

    assert client.get("/api/inventory/doh-thresholds/9/history").status_code == 404


def test_sell_out_is_not_something_a_record_can_carry(monkeypatch):
    seen = {}

    def fake(record):
        seen["fields"] = set(record.model_dump())
        return {"records_written": 1}

    monkeypatch.setattr(inventory_service, "create_records", fake)

    client.post("/api/inventory/records", json={**RECORD, "sell_out_base": 40, "sell_out_building_blocks": 5})

    assert "sell_out_base" not in seen["fields"]
    assert "sell_out_building_blocks" not in seen["fields"]


def test_sell_in_plan_passes_the_chosen_skus_to_the_service(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        inventory_service,
        "get_sell_in_plan",
        lambda customer_id, months, skus: seen.update(skus=skus) or {"rows": []},
    )

    client.get("/api/inventory/customers/1/sell-in-plan?sku=A1&sku=B2")

    assert seen["skus"] == ["A1", "B2"]
