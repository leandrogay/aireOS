import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

pytestmark = pytest.mark.usefixtures("migrated_budget_schema")
from conftest import FakeConnection, FakeEngine

from app.services.scenario import building_blocks as building_blocks_service
from app.services.scenario import common


STAMP = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)

CUSTOMERS = {"fairprice": 1, "sheng_siong": 2}

# product_name is not unique in skus: "Old Pants" has an archived twin.
SKUS = [
    {"sku": "SKU-A", "product_name": "Comfort Pants M", "is_active": True, "sku_range": "Comfort Pants"},
    {"sku": "SKU-B", "product_name": "Old Pants", "is_active": True, "sku_range": None},
    {"sku": "SKU-B-OLD", "product_name": "Old Pants", "is_active": False, "sku_range": None},
    {"sku": "SKU-C", "product_name": "Twin Pants", "is_active": True, "sku_range": None},
    {"sku": "SKU-D", "product_name": "Twin Pants", "is_active": True, "sku_range": None},
    # A leftover range-name insert: its sku is the range, so it doesn't make the range real.
    {"sku": "Ghost Range", "product_name": "Ghost Range", "is_active": True, "sku_range": "Ghost Range"},
]


def _block(**changes):
    block = {
        "kind": "block",
        "customer_names": ["fairprice"],
        "sku_ranges": None,
        "excluded_pairs": [],
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
        # As the SELECT's ARRAY(...): empty for NULL customer_ids (every customer).
        customer_names = sorted(name for name, cid in CUSTOMERS.items() if cid in (block["customer_ids"] or []))
        product_name = next((row["product_name"] for row in SKUS if row["sku"] == block["sku"]), None)
        # As the SELECT: stored ids named back.
        names = {cid: name for name, cid in CUSTOMERS.items()}
        excluded = [
            {"customer_name": names[pair["customer_id"]], "sku_range": pair["sku_range"]}
            for pair in json.loads(block["excluded_pairs"])
        ]
        return {
            "block_id": block_id,
            "customer_names": customer_names,
            "excluded_pairs": excluded,
            "product_name": product_name,
            **{
                key: value
                for key, value in block.items()
                if key not in ("customer_id", "customer_ids", "excluded_pairs")
            },
            "created_at": STAMP,
            "updated_at": STAMP,
        }

    def respond(self, sql, params):
        params = params or {}

        if "FROM customers" in sql and "customer_name = ANY(:customer_names)" in sql:
            return [
                {"customer_id": CUSTOMERS[name], "customer_name": name}
                for name in params["customer_names"]
                if name in CUSTOMERS
            ]

        if "FROM skus" in sql and "product_name = :product_name" in sql:
            return [
                {"sku": row["sku"], "is_active": row["is_active"]}
                for row in SKUS
                if row["product_name"] == params["product_name"]
            ]

        if "FROM skus" in sql and "sku_range = ANY(:sku_ranges)" in sql:
            found = {
                row["sku_range"]
                for row in SKUS
                if row["sku_range"] in params["sku_ranges"] and row["sku"] != row["sku_range"]
            }
            return [(name,) for name in sorted(found)]

        if "kind = 'growth'" in sql:
            return [
                (block_id,)
                for block_id, block in self.blocks.items()
                if block["kind"] == "growth"
                and block["customer_id"] == params["customer_id"]
                and block["start_month"] == params["start_month"]
                and block_id != params["block_id"]
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
        "plan": "scenario",
        "block_id": 1,
        "kind": "block",
        "customer_names": ["fairprice"],
        "sku_ranges": None,
        "excluded_pairs": [],
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
        building_blocks_service.create_building_block(_block(customer_names=["giant"]))

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
        1, _block(customer_names=["sheng_siong"], is_active=False, uplift_value=Decimal("25"))
    )

    (sql, params), = conn.sql_containing("UPDATE scenario_building_blocks")
    assert "updated_at = CURRENT_TIMESTAMP" in sql
    assert params["block_id"] == 1
    assert params["customer_id"] == 2
    assert saved["customer_names"] == ["sheng_siong"]
    assert saved["is_active"] is False
    assert saved["uplift_value"] == 25.0


def test_update_of_a_missing_block_returns_none(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())

    assert building_blocks_service.update_building_block(99, _block()) is None


# ---- Growth ------------------------------------------------------------------


def _growth(**changes):
    return _block(**{"kind": "growth", "name": "Budget growth",
                     "start_month": date(2027, 1, 1), "end_month": date(2027, 12, 1),
                     "uplift_value": Decimal("8"), **changes})


def test_growth_is_saved_with_its_kind(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_growth())

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["kind"] == "growth"
    assert saved["kind"] == "growth"


def test_a_second_growth_for_the_same_customer_and_year_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)
    building_blocks_service.create_building_block(_growth())

    with pytest.raises(
        building_blocks_service.GrowthBlockExistsError,
        match="fairprice already has growth for 2027",
    ):
        building_blocks_service.create_building_block(_growth(uplift_value=Decimal("12")))

    assert len(conn.sql_containing("INSERT INTO")) == 1


def test_growth_for_another_year_or_customer_is_allowed(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())
    building_blocks_service.create_building_block(_growth())

    next_year = building_blocks_service.create_building_block(
        _growth(start_month=date(2028, 1, 1), end_month=date(2028, 12, 1))
    )
    other_customer = building_blocks_service.create_building_block(_growth(customer_names=["sheng_siong"]))

    assert next_year["block_id"] == 2
    assert other_customer["block_id"] == 3


def test_updating_a_growth_block_does_not_clash_with_itself(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())
    building_blocks_service.create_building_block(_growth())

    saved = building_blocks_service.update_building_block(1, _growth(uplift_value=Decimal("12")))

    assert saved["uplift_value"] == 12.0


def test_an_ordinary_block_never_checks_for_growth(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    building_blocks_service.create_building_block(_block())

    assert not conn.sql_containing("kind = 'growth'")


# ---- SKU ranges --------------------------------------------------------------


def test_a_range_block_is_stored_with_its_range_and_no_single_sku(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_block(sku_ranges=["Comfort Pants"]))

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["sku_ranges"] == ["Comfort Pants"]
    assert params["sku"] is None
    assert saved["sku_ranges"] == ["Comfort Pants"]


def test_an_unknown_range_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown SKU range: Nope"):
        building_blocks_service.create_building_block(_block(sku_ranges=["Nope"]))

    assert not conn.sql_containing("INSERT INTO")


def test_a_leftover_range_name_row_does_not_make_a_range_real(monkeypatch):
    _install(monkeypatch, FakeBlocksDatabase())

    with pytest.raises(ValueError, match="Unknown SKU range: Ghost Range"):
        building_blocks_service.create_building_block(_block(sku_ranges=["Ghost Range"]))


def test_overlay_blocks_read_the_sku_codes_of_their_range():
    conn = FakeConnection(lambda sql, params: [])

    building_blocks_service.fetch_blocks_for_customer(conn, 1, [7])

    sql, _ = conn.calls[0]
    assert "AS range_skus" in sql
    assert "product.sku_range = ANY(block.sku_ranges)" in sql


def test_a_block_for_several_ranges_stores_them_all(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)
    SKUS.append({"sku": "SKU-E", "product_name": "Ultra Tape L", "is_active": True, "sku_range": "Ultra Tape"})
    try:
        saved = building_blocks_service.create_building_block(_block(sku_ranges=["Comfort Pants", "Ultra Tape"]))
    finally:
        SKUS.pop()

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["sku_ranges"] == ["Comfort Pants", "Ultra Tape"]
    assert saved["sku_ranges"] == ["Comfort Pants", "Ultra Tape"]


# ---- Switched-off customer x ranges ------------------------------------------------


def test_switched_off_pairs_are_stored_by_customer_id_and_read_back_by_name(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)
    pairs = [
        {"customer_name": "sheng_siong", "sku_range": "Comfort Pants"},
        {"customer_name": "fairprice", "sku_range": None},
    ]

    saved = building_blocks_service.create_building_block(
        _block(customer_names=["fairprice", "sheng_siong"], excluded_pairs=pairs)
    )

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert json.loads(params["excluded_pairs"]) == [
        {"customer_id": 2, "sku_range": "Comfort Pants"},
        {"customer_id": 1, "sku_range": None},
    ]
    assert saved["excluded_pairs"] == pairs


def test_a_switched_off_pair_for_an_unknown_customer_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown customer: giant"):
        building_blocks_service.create_building_block(
            _block(excluded_pairs=[{"customer_name": "giant", "sku_range": "Comfort Pants"}])
        )

    assert conn.sql_containing("INSERT INTO") == []


def test_overlay_blocks_read_this_customers_switched_off_skus():
    conn = FakeConnection(lambda sql, params: [])

    building_blocks_service.fetch_blocks_for_customer(conn, 4, [7])

    sql, _ = conn.calls[0]
    assert "AS excluded_skus" in sql
    assert "(pair ->> 'customer_id')::INTEGER = CAST(:customer_id AS INTEGER)" in sql


# ---- Several customers ----------------------------------------------------------


def test_a_block_for_several_customers_stores_them_all_and_no_single_customer(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_block(customer_names=["fairprice", "sheng_siong"]))

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["customer_ids"] == [1, 2]
    assert params["customer_id"] is None
    assert saved["customer_names"] == ["fairprice", "sheng_siong"]


def test_a_block_for_every_customer_is_stored_as_null_and_read_back_as_none(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    saved = building_blocks_service.create_building_block(_block(customer_names=None))

    (_, params), = conn.sql_containing("INSERT INTO scenario_building_blocks")
    assert params["customer_ids"] is None
    assert params["customer_id"] is None
    assert saved["customer_names"] is None


def test_one_unknown_customer_among_several_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown customer: giant"):
        building_blocks_service.create_building_block(_block(customer_names=["fairprice", "giant"]))

    assert conn.sql_containing("INSERT INTO") == []


def test_overlay_blocks_cover_their_customers_or_every_customer():
    conn = FakeConnection(lambda sql, params: [])

    building_blocks_service.fetch_blocks_for_customer(conn, 4, [7])

    sql, params = conn.calls[0]
    assert "block.customer_ids IS NULL OR CAST(:customer_id AS INTEGER) = ANY(block.customer_ids)" in sql
    assert params["customer_id"] == 4


def test_one_unknown_range_among_several_raises_without_writing(monkeypatch):
    db = FakeBlocksDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(ValueError, match="Unknown SKU range: Nope"):
        building_blocks_service.create_building_block(_block(sku_ranges=["Comfort Pants", "Nope"]))

    assert not conn.sql_containing("INSERT INTO")


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
    # The list is the one read ordered by block (each block's customer names have their own ORDER BY).
    (sql, _), = conn.sql_containing("block.created_at DESC")
    assert "block.block_id DESC" in sql


# ---- blocks for the sell-in plan overlay ----


def test_overlay_blocks_are_read_for_the_one_customer_and_the_picked_ids():
    conn = FakeConnection(
        lambda sql, params: [
            {
                "block_id": 7,
                "sku": None,
                "excluded_skus": [],
                "name": "New store",
                "uplift_mode": "units",
                "uplift_value": Decimal("-120"),
                "start_month": date(2026, 11, 1),
                "end_month": date(2026, 12, 1),
            }
        ]
    )

    blocks = building_blocks_service.fetch_blocks_for_customer(conn, 1, [7, 9])

    sql, params = conn.calls[0]
    assert "FROM scenario_building_blocks" in sql
    assert params == {"customer_id": 1, "block_ids": [7, 9]}
    assert blocks[0]["uplift_value"] == -120.0
    assert isinstance(blocks[0]["uplift_value"], float)


def test_no_picked_blocks_reads_nothing():
    conn = FakeConnection()

    assert building_blocks_service.fetch_blocks_for_customer(conn, 1, []) == []
    assert conn.calls == []
