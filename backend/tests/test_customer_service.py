import pytest
from conftest import FakeConnection, FakeEngine

from app.schemas.catalog import CustomerCreate, CustomerUpdate
from app.services import customer_service


def _customer(in_use=False, retailers=()):
    return {
        "customer_id": 3,
        "customer_name": "giant",
        "retailers": list(retailers),
        "in_use": in_use,
    }


def _retailer(in_use=False):
    return {
        "retailer_id": 8,
        "retailer_name": "giant_online",
        "store_count": 1 if in_use else 0,
        "in_use": in_use,
    }


def _respond(customer=None, name_taken=False, unlinked=()):
    """Answers each statement customer_service sends, by its distinctive SQL."""

    def respond(sql, params):
        if "lower(customer_name)" in sql:
            return [(name_taken,)]
        if "FROM customers c" in sql:
            return [customer] if customer else []
        if "NOT EXISTS" in sql:
            return list(unlinked)
        if "INSERT INTO customers" in sql:
            return [(3,)]
        return []

    return respond


def _install(monkeypatch, conn):
    monkeypatch.setattr(customer_service, "_get_engine", lambda: FakeEngine(conn))
    monkeypatch.setattr(customer_service, "_get_read_engine", lambda: FakeEngine(conn))


# ---- list ----------------------------------------------------------------------


def test_list_returns_customers_with_retailers_and_the_unlinked_retailers(monkeypatch):
    customer = _customer(retailers=[_retailer()])
    unlinked = {"retailer_id": 9, "retailer_name": "sheng_siong_online", "store_count": 2, "in_use": True}
    conn = FakeConnection(_respond(customer=customer, unlinked=[unlinked]))
    _install(monkeypatch, conn)

    result = customer_service.list_customers()

    assert result == {"customers": [customer], "unlinked_retailers": [unlinked]}
    sql, params = conn.sql_containing("FROM customers c")[0]
    assert params == {"customer_id": None}
    # A customer is in use through its retailers' stores or its own inventory rows.
    for table in ("stores", "inventory_metrics"):
        assert table in sql


# ---- create --------------------------------------------------------------------


def test_create_inserts_the_slug_and_returns_the_row(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer()))
    _install(monkeypatch, conn)

    created = customer_service.create_customer(CustomerCreate(customer_name="Giant"))

    assert created == _customer()
    _, params = conn.sql_containing("INSERT INTO customers")[0]
    assert params == {"customer_name": "giant"}


def test_a_taken_name_raises_without_inserting(monkeypatch):
    conn = FakeConnection(_respond(name_taken=True))
    _install(monkeypatch, conn)

    with pytest.raises(customer_service.CustomerNameTakenError, match='"giant" already exists'):
        customer_service.create_customer(CustomerCreate(customer_name="GIANT"))

    _, params = conn.sql_containing("lower(customer_name)")[0]
    assert params == {"customer_name": "giant", "exclude_id": None}
    assert conn.sql_containing("INSERT INTO customers") == []


# ---- update --------------------------------------------------------------------


def test_rename_excludes_its_own_row_from_the_duplicate_check(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer()))
    _install(monkeypatch, conn)

    customer_service.update_customer(3, CustomerUpdate(customer_name="Giant Hyper"))

    _, params = conn.sql_containing("lower(customer_name)")[0]
    assert params == {"customer_name": "giant_hyper", "exclude_id": 3}
    _, params = conn.sql_containing("UPDATE customers")[0]
    assert params == {"customer_id": 3, "customer_name": "giant_hyper"}


def test_a_customer_in_use_cannot_be_renamed(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer(in_use=True)))
    _install(monkeypatch, conn)

    with pytest.raises(customer_service.CustomerInUseError, match="can't be renamed"):
        customer_service.update_customer(3, CustomerUpdate(customer_name="other"))

    assert conn.sql_containing("UPDATE customers") == []


def test_renaming_a_missing_customer_returns_none(monkeypatch):
    conn = FakeConnection(_respond(customer=None))
    _install(monkeypatch, conn)

    assert customer_service.update_customer(3, CustomerUpdate(customer_name="giant")) is None
    assert conn.sql_containing("UPDATE customers") == []


# ---- delete --------------------------------------------------------------------


def test_a_customer_in_use_cannot_be_deleted(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer(in_use=True)))
    _install(monkeypatch, conn)

    with pytest.raises(customer_service.CustomerInUseError, match="can't be deleted"):
        customer_service.delete_customer(3)

    assert conn.sql_containing("DELETE FROM customers") == []


def test_a_customer_with_retailers_cannot_be_deleted(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer(retailers=[_retailer()])))
    _install(monkeypatch, conn)

    with pytest.raises(customer_service.CustomerHasRetailersError):
        customer_service.delete_customer(3)

    assert conn.sql_containing("DELETE FROM customers") == []


def test_an_unused_customer_is_deleted(monkeypatch):
    conn = FakeConnection(_respond(customer=_customer()))
    _install(monkeypatch, conn)

    assert customer_service.delete_customer(3) is True
    _, params = conn.sql_containing("DELETE FROM customers")[0]
    assert params == {"customer_id": 3}


def test_deleting_a_missing_customer_returns_false(monkeypatch):
    conn = FakeConnection(_respond(customer=None))
    _install(monkeypatch, conn)

    assert customer_service.delete_customer(3) is False
    assert conn.sql_containing("DELETE FROM customers") == []
