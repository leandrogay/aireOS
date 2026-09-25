from conftest import FakeConnection, FakeEngine

from app.services import customer_service


def _install_fake_engine(monkeypatch, respond):
    engine = FakeEngine(FakeConnection(respond))
    monkeypatch.setattr(customer_service, "_get_read_engine", lambda: engine)
    return engine


# ---- get_customer_names ----------------------------------------------------------


def test_looks_up_customer_names_for_given_ids(monkeypatch):
    engine = _install_fake_engine(monkeypatch, lambda sql, params: [(1, "fairprice"), (2, "sheng_shiong")])

    names = customer_service.get_customer_names([1, 2, 1])

    assert names == {1: "fairprice", 2: "sheng_shiong"}
    sql, params = engine.conn.calls[0]
    assert "customer_id = ANY" in sql
    # Duplicates are collapsed before they reach Postgres.
    assert params == {"customer_ids": [1, 2]}


def test_no_customer_ids_skips_the_query(monkeypatch):
    engine = _install_fake_engine(monkeypatch, lambda sql, params: [])

    assert customer_service.get_customer_names([]) == {}
    assert engine.conn.calls == []


# ---- list_customers ---------------------------------------------------------------


def test_list_customers_orders_by_id(monkeypatch):
    rows = [
        {"customer_id": 1, "customer_name": "fairprice"},
        {"customer_id": 2, "customer_name": "sheng_shiong"},
    ]
    # FakeResult.mappings() does dict(row) over each row, so handing back
    # already-dict rows round-trips cleanly.
    engine = _install_fake_engine(monkeypatch, lambda sql, params: rows)

    result = customer_service.list_customers()

    assert result == rows
    sql, _ = engine.conn.calls[0]
    assert "ORDER BY" in sql
