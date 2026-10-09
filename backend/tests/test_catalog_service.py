import pytest
from conftest import FakeConnection, FakeEngine

from app.schemas.catalog import RetailerCreate, RetailerUpdate
from app.services import catalog_service
from app.services.settings.common import CustomerNotFoundError


# ---- get_or_create_retailers -------------------------------------------------


def test_retailers_are_upserted_in_one_statement():
    conn = FakeConnection(
        lambda sql, params: [("fairprice", 1), ("giant", 2)]
    )

    ids = catalog_service.get_or_create_retailers(
        conn, ["fairprice", "giant", "fairprice"]
    )

    assert ids == {"fairprice": 1, "giant": 2}
    assert len(conn.calls) == 1

    sql, params = conn.calls[0]
    assert "unnest" in sql
    assert "ON CONFLICT (retailer_name)" in sql
    # Duplicates are collapsed before they reach Postgres.
    assert params == {"retailer_names": ["fairprice", "giant"]}


def test_no_retailer_names_skips_the_query():
    conn = FakeConnection()

    assert catalog_service.get_or_create_retailers(conn, []) == {}
    assert conn.calls == []


# ---- get_or_create_stores ----------------------------------------------------


def _store(retailer_id, code, name="Store", fmt=None):
    return {
        "retailer_id": retailer_id,
        "store_code": code,
        "store_name": name,
        "store_format": fmt,
    }


def test_stores_are_upserted_in_one_statement_with_parallel_arrays():
    conn = FakeConnection(
        lambda sql, params: [(1, "BM01", 10), (1, "TP02", 11)]
    )

    ids = catalog_service.get_or_create_stores(
        conn,
        [
            _store(1, "BM01", "Bedok Mall", "Mall"),
            _store(1, "TP02", "Tampines", None),
        ],
    )

    assert ids == [10, 11]
    assert len(conn.calls) == 1

    sql, params = conn.calls[0]
    assert "ON CONFLICT ( retailer_id, store_code )" in sql
    assert params == {
        "retailer_ids": [1, 1],
        "store_codes": ["BM01", "TP02"],
        "store_names": ["Bedok Mall", "Tampines"],
        "store_formats": ["Mall", None],
    }


def test_store_ids_follow_input_order_not_returning_order():
    # RETURNING has no ordering guarantee, so the rows come
    # back reversed here and must still be mapped correctly.
    conn = FakeConnection(
        lambda sql, params: [(2, "B", 22), (1, "A", 11)]
    )

    ids = catalog_service.get_or_create_stores(
        conn, [_store(1, "A"), _store(2, "B")]
    )

    assert ids == [11, 22]


def test_no_stores_skips_the_query():
    conn = FakeConnection()

    assert catalog_service.get_or_create_stores(conn, []) == []
    assert conn.calls == []


def _install_fake_read_engine(monkeypatch, respond):
    engine = FakeEngine(FakeConnection(respond))
    monkeypatch.setattr(catalog_service, "_get_read_engine", lambda: engine)
    return engine


# ---- get_product_prices ---------------------------------------------------------


def test_returns_a_price_per_product_name(monkeypatch):
    engine = _install_fake_read_engine(
        monkeypatch, lambda sql, params: [("Widget", 14.0), ("Gadget", 9.5)]
    )

    prices = catalog_service.get_product_prices()

    assert prices == {"Widget": 14.0, "Gadget": 9.5}
    sql, _ = engine.conn.calls[0]
    assert "price IS NOT NULL" in sql


# ---- retailers under a customer (Customers page) --------------------------------


_CUSTOMER_ROW = {"customer_id": 3, "customer_name": "giant", "retailers": [], "in_use": False}


def _retailer_row(in_use=False, customer_id=3):
    return {
        "retailer_id": 8,
        "retailer_name": "giant_online",
        "customer_id": customer_id,
        "store_count": 1 if in_use else 0,
        "in_use": in_use,
    }


def _retailer_respond(retailer=None, customer_exists=True, name_taken=False):
    """Answers each statement the retailer writes send, by its distinctive SQL."""

    def respond(sql, params):
        if "FOR NO KEY UPDATE" in sql:
            return [(3,)] if customer_exists else []
        if "lower(retailer_name)" in sql:
            return [(name_taken,)]
        if "LEFT JOIN customer_retailers cr" in sql:
            return [retailer] if retailer else []
        if "FROM customers c" in sql:
            return [_CUSTOMER_ROW]
        if "INSERT INTO retailers" in sql:
            return [(8,)]
        return []

    return respond


def _install_fake_engine(monkeypatch, respond):
    conn = FakeConnection(respond)
    monkeypatch.setattr(catalog_service, "_get_engine", lambda: FakeEngine(conn))
    return conn


def _statement_order(conn, fragments):
    return [
        next(i for i, (sql, _) in enumerate(conn.calls) if fragment in sql)
        for fragment in fragments
    ]


def test_a_new_retailer_is_linked_to_its_customer_in_the_same_transaction(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row()))

    result = catalog_service.create_retailer(
        RetailerCreate(retailer_name="Giant Online", customer_id=3)
    )

    assert result == {"retailer": _retailer_row(), "customer": _CUSTOMER_ROW}
    _, params = conn.sql_containing("INSERT INTO retailers")[0]
    assert params == {"retailer_name": "giant_online"}
    _, params = conn.sql_containing("INSERT INTO customer_retailers")[0]
    assert params == {"customer_id": 3, "retailer_id": 8}


def test_a_retailer_for_a_missing_customer_raises_without_inserting(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(customer_exists=False))

    with pytest.raises(CustomerNotFoundError):
        catalog_service.create_retailer(RetailerCreate(retailer_name="giant_online", customer_id=3))

    assert conn.sql_containing("INSERT INTO") == []


def test_a_taken_retailer_name_raises_without_inserting(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(name_taken=True))

    with pytest.raises(catalog_service.RetailerNameTakenError, match='"giant_online" already exists'):
        catalog_service.create_retailer(RetailerCreate(retailer_name="Giant ONLINE", customer_id=3))

    assert conn.sql_containing("INSERT INTO") == []


def test_a_retailer_in_use_cannot_be_renamed(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row(in_use=True)))

    with pytest.raises(catalog_service.RetailerHasStoresError, match="can't be renamed"):
        catalog_service.update_retailer(8, RetailerUpdate(retailer_name="giant_web"))

    assert conn.sql_containing("UPDATE retailers") == []


def test_rename_excludes_the_retailer_from_its_own_duplicate_check(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row()))

    result = catalog_service.update_retailer(8, RetailerUpdate(retailer_name="Giant Web"))

    assert result["customer"] == _CUSTOMER_ROW
    _, params = conn.sql_containing("lower(retailer_name)")[0]
    assert params == {"retailer_name": "giant_web", "exclude_id": 8}
    _, params = conn.sql_containing("UPDATE retailers")[0]
    assert params == {"retailer_id": 8, "retailer_name": "giant_web"}


def test_delete_removes_the_customer_link_before_the_retailer(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row()))

    result = catalog_service.delete_retailer(8)

    assert result == {"customer": _CUSTOMER_ROW}
    link, retailer = _statement_order(
        conn, ["DELETE FROM customer_retailers", "DELETE FROM retailers"]
    )
    assert link < retailer


def test_a_retailer_in_use_cannot_be_deleted(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row(in_use=True)))

    with pytest.raises(catalog_service.RetailerHasStoresError, match="can't be deleted"):
        catalog_service.delete_retailer(8)

    assert conn.sql_containing("DELETE FROM") == []


def test_deleting_an_unlinked_retailer_returns_no_customer(monkeypatch):
    _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row(customer_id=None)))

    assert catalog_service.delete_retailer(8) == {"customer": None}


def test_a_retailer_that_already_has_a_customer_cannot_be_linked_again(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row()))

    with pytest.raises(catalog_service.RetailerAlreadyLinkedError):
        catalog_service.link_retailer(8, 3)

    assert conn.sql_containing("INSERT INTO customer_retailers") == []


def test_an_unlinked_retailer_is_linked(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _retailer_respond(retailer=_retailer_row(customer_id=None)))

    catalog_service.link_retailer(8, 3)

    _, params = conn.sql_containing("INSERT INTO customer_retailers")[0]
    assert params == {"customer_id": 3, "retailer_id": 8}
