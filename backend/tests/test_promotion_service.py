import pytest
from conftest import FakeConnection, FakeEngine

from app.schemas.promotions import PromotionCreate
from app.services import promotion_service


# ---- helpers -----------------------------------------------------------------


def _payload(stores=None, skus=None) -> PromotionCreate:
    return PromotionCreate(
        stores=stores
        or [
            {"retailer": "fairprice", "store_name": "Bedok", "store_code": "BM01"},
        ],
        period_start="2026-01-01",
        period_end="2026-01-31",
        promo_type="monthly",
        skus=skus or [],
    )


def _respond(sql, params):
    """Canned Cloud SQL: one retailer, stores 10.. by position, two ranges."""
    if "INSERT INTO promotions" in sql:
        return [(99,)]

    if "INSERT INTO retailers" in sql:
        return [
            (name, index + 1)
            for index, name in enumerate(params["retailer_names"])
        ]

    if "INSERT INTO stores" in sql:
        return [
            (retailer_id, code, 10 + index)
            for index, (retailer_id, code) in enumerate(
                zip(params["retailer_ids"], params["store_codes"])
            )
        ]

    if "sku_range = ANY" in sql:
        catalog = {
            "Pants": [("Pants", "P-L"), ("Pants", "P-M")],
            "Tape": [("Tape", "T-1")],
        }
        return [
            row
            for name in params["sku_ranges"]
            for row in catalog.get(name, [])
        ]

    if "sku = ANY" in sql:
        return [(code,) for code in params["skus"] if code == "LOOSE-1"]

    if "FROM promotions p" in sql:
        return [{"promotion_id": params["promotion_id"], "stores": [], "skus": []}]

    return []


def _install_fake_engine(monkeypatch, respond=_respond):
    conn = FakeConnection(respond)
    monkeypatch.setattr(promotion_service, "_get_engine", lambda: FakeEngine(conn))
    return conn


# ---- create_promotion round trips --------------------------------------------


def test_create_with_many_stores_costs_a_fixed_number_of_statements(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    stores = [
        {"retailer": "fairprice", "store_name": f"Store {i}", "store_code": f"S{i:03}"}
        for i in range(40)
    ]

    result = promotion_service.create_promotion(_payload(stores=stores))

    assert result["promotion_id"] == 99
    # insert promotion, upsert retailers, upsert stores,
    # insert links, fetch. Never one statement per store.
    assert len(conn.calls) == 5


def test_store_links_are_inserted_from_one_array(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            stores=[
                {"retailer": "fairprice", "store_name": "A", "store_code": "A1"},
                {"retailer": "giant", "store_name": "B", "store_code": "B1"},
            ]
        )
    )

    [(sql, params)] = conn.sql_containing("INSERT INTO promotion_stores")
    assert "unnest" in sql
    assert params == {"promotion_id": 99, "store_ids": [10, 11]}


def test_each_retailer_name_is_sent_once(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            stores=[
                {"retailer": "fairprice", "store_name": "A", "store_code": "A1"},
                {"retailer": "fairprice", "store_name": "B", "store_code": "B1"},
            ]
        )
    )

    [(_, params)] = conn.sql_containing("INSERT INTO retailers")
    assert params == {"retailer_names": ["fairprice"]}


# ---- SKU resolution ----------------------------------------------------------


def test_ranges_resolve_to_catalog_skus_in_one_query(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            skus=[
                {"sku": "Pants", "sku_range": "Pants"},
                {"sku": "Tape", "sku_range": "Tape"},
            ]
        )
    )

    assert len(conn.sql_containing("sku_range = ANY")) == 1
    # Every range matched, so the exact-sku fallback is skipped.
    assert conn.sql_containing("sku = ANY") == []

    [(_, params)] = conn.sql_containing("INSERT INTO promotion_skus")
    assert params == {"promotion_id": 99, "skus": ["P-L", "P-M", "T-1"]}


def test_unmatched_range_falls_back_to_exact_sku(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            skus=[
                {"sku": "Pants", "sku_range": "Pants"},
                {"sku": "LOOSE-1", "sku_range": "Unknown"},
            ]
        )
    )

    [(_, params)] = conn.sql_containing("sku = ANY")
    assert params == {"skus": ["LOOSE-1"]}

    [(_, params)] = conn.sql_containing("INSERT INTO promotion_skus")
    assert params["skus"] == ["P-L", "P-M", "LOOSE-1"]


def test_no_matching_skus_raises(monkeypatch):
    _install_fake_engine(monkeypatch)

    with pytest.raises(ValueError, match="No catalog SKUs"):
        promotion_service.create_promotion(
            _payload(skus=[{"sku": "Nope", "sku_range": "Nope"}])
        )


def test_no_sku_items_skips_sku_queries(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(_payload())

    assert conn.sql_containing("FROM skus") == []
    assert conn.sql_containing("INSERT INTO promotion_skus") == []
