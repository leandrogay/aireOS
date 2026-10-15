from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.services import catalog_service, customer_service
from app.services.settings.common import CustomerNotFoundError

client = TestClient(app)

CUSTOMER = {"customer_id": 3, "customer_name": "giant", "retailers": [], "in_use": False}


def _raises(exc):
    def _raise(*args, **kwargs):
        raise exc

    return _raise


def _integrity_error():
    return IntegrityError("INSERT ...", {}, Exception("duplicate key"))


def _no_call_allowed(*args, **kwargs):
    raise AssertionError("the service must not be called")


# ---- customers -----------------------------------------------------------------


def test_list_customers_is_200(monkeypatch):
    listing = {"customers": [CUSTOMER], "unlinked_retailers": []}
    monkeypatch.setattr(customer_service, "list_customers", lambda: listing)

    response = client.get("/api/catalog/customers")

    assert response.status_code == 200
    assert response.json() == listing


def test_list_customers_failure_is_500_with_the_reason(monkeypatch):
    monkeypatch.setattr(customer_service, "list_customers", _raises(RuntimeError("db down")))

    response = client.get("/api/catalog/customers")

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to retrieve customers: RuntimeError: db down"


def test_create_customer_is_201_and_sends_the_slug(monkeypatch):
    seen = {}

    def fake(customer):
        seen["name"] = customer.customer_name
        return CUSTOMER

    monkeypatch.setattr(customer_service, "create_customer", fake)

    response = client.post("/api/catalog/customers", json={"customer_name": " Giant "})

    assert response.status_code == 201
    assert seen == {"name": "giant"}


def test_a_blank_customer_name_is_422_without_calling_the_service(monkeypatch):
    monkeypatch.setattr(customer_service, "create_customer", _no_call_allowed)

    response = client.post("/api/catalog/customers", json={"customer_name": "   "})

    assert response.status_code == 422


def test_a_taken_customer_name_is_409_with_the_message(monkeypatch):
    monkeypatch.setattr(
        customer_service,
        "create_customer",
        _raises(customer_service.CustomerNameTakenError('A customer named "giant" already exists.')),
    )

    response = client.post("/api/catalog/customers", json={"customer_name": "giant"})

    assert response.status_code == 409
    assert response.json()["detail"] == 'A customer named "giant" already exists.'


def test_a_unique_violation_on_create_is_409(monkeypatch):
    monkeypatch.setattr(customer_service, "create_customer", _raises(_integrity_error()))

    response = client.post("/api/catalog/customers", json={"customer_name": "giant"})

    assert response.status_code == 409


def test_renaming_a_missing_customer_is_404(monkeypatch):
    monkeypatch.setattr(customer_service, "update_customer", lambda customer_id, customer: None)

    response = client.put("/api/catalog/customers/9", json={"customer_name": "giant"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Customer not found"


def test_renaming_a_customer_in_use_is_409(monkeypatch):
    monkeypatch.setattr(
        customer_service,
        "update_customer",
        _raises(customer_service.CustomerInUseError("can't be renamed")),
    )

    response = client.put("/api/catalog/customers/3", json={"customer_name": "giant"})

    assert response.status_code == 409


def test_deleting_a_customer_with_retailers_is_409(monkeypatch):
    monkeypatch.setattr(
        customer_service,
        "delete_customer",
        _raises(customer_service.CustomerHasRetailersError("Delete the retailers first.")),
    )

    response = client.delete("/api/catalog/customers/3")

    assert response.status_code == 409
    assert response.json()["detail"] == "Delete the retailers first."


def test_a_foreign_key_violation_on_customer_delete_is_409(monkeypatch):
    monkeypatch.setattr(customer_service, "delete_customer", _raises(_integrity_error()))

    response = client.delete("/api/catalog/customers/3")

    assert response.status_code == 409


def test_deleting_a_missing_customer_is_404(monkeypatch):
    monkeypatch.setattr(customer_service, "delete_customer", lambda customer_id: False)

    response = client.delete("/api/catalog/customers/9")

    assert response.status_code == 404


# ---- retailers -----------------------------------------------------------------


def test_a_retailer_for_a_missing_customer_is_404(monkeypatch):
    monkeypatch.setattr(
        catalog_service,
        "create_retailer",
        _raises(CustomerNotFoundError("Customer 9 does not exist.")),
    )

    response = client.post("/api/catalog/retailers", json={"retailer_name": "giant_online", "customer_id": 9})

    assert response.status_code == 404
    assert response.json()["detail"] == "Customer 9 does not exist."


def test_a_retailer_without_a_customer_is_422(monkeypatch):
    monkeypatch.setattr(catalog_service, "create_retailer", _no_call_allowed)

    response = client.post("/api/catalog/retailers", json={"retailer_name": "giant_online"})

    assert response.status_code == 422


def test_renaming_a_retailer_in_use_is_409(monkeypatch):
    monkeypatch.setattr(
        catalog_service,
        "update_retailer",
        _raises(catalog_service.RetailerHasStoresError("can't be renamed")),
    )

    response = client.put("/api/catalog/retailers/8", json={"retailer_name": "giant_web"})

    assert response.status_code == 409


def test_linking_a_retailer_that_has_a_customer_is_409(monkeypatch):
    monkeypatch.setattr(
        catalog_service,
        "link_retailer",
        _raises(catalog_service.RetailerAlreadyLinkedError("already belongs to a customer")),
    )

    response = client.put("/api/catalog/retailers/8/customer", json={"customer_id": 3})

    assert response.status_code == 409


def test_deleting_a_retailer_returns_its_customer(monkeypatch):
    monkeypatch.setattr(catalog_service, "delete_retailer", lambda retailer_id: {"customer": CUSTOMER})

    response = client.delete("/api/catalog/retailers/8")

    assert response.status_code == 200
    assert response.json()["customer"] == CUSTOMER


def test_deleting_a_retailer_in_use_is_409(monkeypatch):
    monkeypatch.setattr(
        catalog_service,
        "delete_retailer",
        _raises(catalog_service.RetailerHasStoresError("can't be deleted")),
    )

    response = client.delete("/api/catalog/retailers/8")

    assert response.status_code == 409
