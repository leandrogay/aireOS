from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.scenario import building_blocks as building_blocks_service
from app.services.scenario import common


STAMP = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)

CUSTOMERS = {"fairprice": 1, "sheng_siong": 2}

# product_name is not unique in skus: "Old Pants" has an archived twin.
SKUS = [
    {"sku": "SKU-A", "product_name": "Comfort Pants M", "is_active": True},
    {"sku": "SKU-B", "product_name": "Old Pants", "is_active": True},
    {"sku": "SKU-B-OLD", "product_name": "Old Pants", "is_active": False},
    {"sku": "SKU-C", "product_name": "Twin Pants", "is_active": True},
    {"sku": "SKU-D", "product_name": "Twin Pants", "is_active": True},
]


def _block(**changes):
    block = {
        "customer_name": "fairprice",
        "product_name": None,
        "name": "New Store Opening",
        "explanation": None,
        "uplift_mode": "pct",
        "uplift_value": Decimal("10"),
        "start_month": date(2026, 11, 1),
        "end_month": date(2026, 12, 1),
        "is_active": True,
    }
    block.update(changes)
    return block


class FakeBlocksDatabase:
    """
    In-memory customers + skus + scenario_building_blocks, answering the
    statements the service sends, so tests can check what the service does
    with the answers. The real SQL is only proven against Postgres.
    """

    def __init__(self):
        self.blocks = {}
        self.next_id = 1

    def _view_row(self, block_id):
        block = self.blocks[block_id]
        customer_name = next(name for name, cid in CUSTOMERS.items() if cid == block["customer_id"])
        product_name = next((row["product_name"] for row in SKUS if row["sku"] == block["sku"]), None)
        return {
            "block_id": block_id,
            "customer_name": customer_name,
            "product_name": product_name,
            **{key: value for key, value in block.items() if key != "customer_id"},
            "created_at": STAMP,
            "updated_at": STAMP,
        }

    def respond(self, sql, params):
        params = params or {}

        if "FROM customers" in sql and "customer_name = :customer_name" in sql:
            customer_id = CUSTOMERS.get(params["customer_name"])
            return [(customer_id,)] if customer_id else []

        if "FROM skus" in sql and "product_name = :product_name" in sql:
            return [
                {"sku": row["sku"], "is_active": row["is_active"]}
                for row in SKUS
                if row["product_name"] == params["product_name"]
            ]

        if sql.startswith("INSERT INTO scenario_building_blocks"):
            block_id = self.next_id
            self.next_id += 1
            self.blocks[block_id] = dict(params)
            return [(block_id,)]

        if sql.startswith("UPDATE scenario_building_blocks"):
            block_id = params["block_id"]
            if block_id not in self.blocks:
                return []
            self.blocks[block_id] = {key: value for key, value in params.items() if key != "block_id"}
            return [(block_id,)]

        if sql.startswith("DELETE FROM scenario_building_blocks"):
            block_id = params["block_id"]
            if block_id not in self.blocks:
                return []
            del self.blocks[block_id]
            return [(block_id,)]

        if "FROM scenario_building_blocks" in sql:
            ids = [params["block_id"]] if "block_id = :block_id" in sql else sorted(self.blocks, reverse=True)
            return [self._view_row(block_id) for block_id in ids if block_id in self.blocks]

        return []


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


# ---- Create ------------------------------------------------------------------


def test_create_resolves_names_to_foreign_keys(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    building_blocks_service.create_building_block(_block(product_name="Comfort Pants M"))

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["customer_id"] == 1
    assert params["sku"] == "SKU-A"
    assert params["uplift_mode"] == "pct"
    assert params["uplift_value"] == Decimal("10")


def test_create_returns_the_block_as_the_list_shows_it(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())

    saved = building_blocks_service.create_building_block(
        _block(product_name="Comfort Pants M", uplift_mode="units", uplift_value=Decimal("900"))
    )

    assert saved == {
        "block_id": 1,
        "customer_name": "fairprice",
        "sku": "SKU-A",
        "product_name": "Comfort Pants M",
        "name": "New Store Opening",
        "explanation": None,
        "uplift_mode": "units",
        "uplift_value": 900.0,
        "start_month": "2026-11-01",
        "end_month": "2026-12-01",
        "is_active": True,
        "created_at": "2026-10-22T08:00:00+00:00",
        "updated_at": "2026-10-22T08:00:00+00:00",
    }


def test_all_skus_is_stored_as_a_null_sku(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_block(product_name=None))

    assert saved["sku"] is None
    assert saved["product_name"] is None
    assert not conn.sql_containing("FROM skus")


def test_an_archived_twin_gives_way_to_the_active_sku(monkeypatch):
    db = FakeBlocksDatabase()
    _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_block(product_name="Old Pants"))

    assert saved["sku"] == "SKU-B"


# ---- Unknown names -----------------------------------------------------------


def test_an_unknown_customer_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown customer: giant"):
        building_blocks_service.create_building_block(_block(customer_name="giant"))

    assert not conn.sql_containing("INSERT INTO")


def test_an_unknown_product_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown product: Nope"):
        building_blocks_service.create_building_block(_block(product_name="Nope"))

    assert not conn.sql_containing("INSERT INTO")


def test_two_active_skus_with_one_name_are_refused(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="More than one SKU is named Twin Pants"):
        building_blocks_service.create_building_block(_block(product_name="Twin Pants"))

    assert not conn.sql_containing("INSERT INTO")


# ---- Update ------------------------------------------------------------------


def test_update_replaces_every_field_and_stamps_updated_at(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)
    building_blocks_service.create_building_block(_block())

    saved = building_blocks_service.update_building_block(
        1, _block(customer_name="sheng_siong", is_active=False, uplift_value=Decimal("25"))
    )

    (sql, params), = conn.sql_containing("UPDATE scenario_building_blocks")
    assert "updated_at = CURRENT_TIMESTAMP" in sql
    assert params["block_id"] == 1
    assert params["customer_id"] == 2
    assert saved["customer_name"] == "sheng_siong"
    assert saved["is_active"] is False
    assert saved["uplift_value"] == 25.0


def test_update_of_a_missing_block_returns_none(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())

    assert building_blocks_service.update_building_block(99, _block()) is None


# ---- Delete and list ---------------------------------------------------------


def test_delete_removes_the_block(monkeypatch):
    db = FakeBlocksDatabase()
    _install(monkeypatch, db)
    building_blocks_service.create_building_block(_block())

    assert building_blocks_service.delete_building_block(1) is True
    assert building_blocks_service.list_building_blocks() == []


def test_delete_of_a_missing_block_returns_false(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())

    assert building_blocks_service.delete_building_block(99) is False


def test_list_returns_newest_first(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)
    building_blocks_service.create_building_block(_block(name="First"))
    building_blocks_service.create_building_block(_block(name="Second"))

    blocks = building_blocks_service.list_building_blocks()

    assert [block["name"] for block in blocks] == ["Second", "First"]
    (sql, _), = [call for call in conn.sql_containing("ORDER BY") if "FROM scenario_building_blocks" in call[0]]
    assert "block.created_at DESC" in sql
