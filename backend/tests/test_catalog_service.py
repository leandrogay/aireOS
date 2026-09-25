from conftest import FakeConnection, FakeEngine

from app.services import catalog_service


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
