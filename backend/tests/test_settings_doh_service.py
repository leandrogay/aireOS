from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.settings import common
from app.services.settings import doh as doh_service


STAMP = datetime(2026, 9, 26, 8, 0, tzinfo=timezone.utc)


class FakeDohDatabase:
    """
    In-memory customers + doh_settings + current_settings, answering the
    statements the service sends. The rules for "latest version" and "only
    insert when different" are reproduced here so tests can check what the
    service does with the answers; the real SQL is only proven against
    Postgres. Any UPDATE or DELETE on doh_settings fails the test.
    """

    def __init__(self, customers=None):
        self.customers = {
            customer_id: {"customer_name": name, "doh_alert_enabled": True, "doh_alert_updated_at": STAMP}
            for customer_id, name in (customers or {1: "fairprice"}).items()
        }
        self.settings = []
        # Every insert gets the same timestamp, as rows written in one
        # transaction do, so setting_id is what orders them.
        self.now = STAMP + timedelta(hours=1)

    def add_version(self, customer_id, min_doh, target_doh, max_doh, updated_at=None, updated_by=None):
        row = {
            "setting_id": len(self.settings) + 1,
            "customer_id": customer_id,
            "min_doh": Decimal(min_doh),
            "target_doh": Decimal(target_doh),
            "max_doh": Decimal(max_doh),
            "updated_at": updated_at or self.now,
            "updated_by": updated_by,
        }
        self.settings.append(row)
        return row

    def _versions(self, customer_id):
        rows = [row for row in self.settings if row["customer_id"] == customer_id]
        return sorted(rows, key=lambda row: (row["updated_at"], row["setting_id"]), reverse=True)

    def _view_row(self, customer_id):
        customer = self.customers[customer_id]
        versions = self._versions(customer_id)
        latest = versions[0] if versions else {}
        return {
            "customer_id": customer_id,
            **customer,
            "setting_id": latest.get("setting_id"),
            "min_doh": latest.get("min_doh"),
            "target_doh": latest.get("target_doh"),
            "max_doh": latest.get("max_doh"),
            "thresholds_updated_at": latest.get("updated_at"),
            "thresholds_updated_by": latest.get("updated_by"),
        }

    def respond(self, sql, params):
        if "UPDATE doh_settings" in sql or "DELETE FROM doh_settings" in sql:
            raise AssertionError(f"doh_settings is append-only: {sql}")

        params = params or {}
        customer_id = params.get("customer_id")

        if sql.startswith("INSERT INTO doh_settings"):
            values = (params["min_doh"], params["target_doh"], params["max_doh"])
            versions = self._versions(customer_id)
            if versions and (versions[0]["min_doh"], versions[0]["target_doh"], versions[0]["max_doh"]) == values:
                return []
            row = self.add_version(customer_id, *values, updated_by=params["updated_by"])
            return [{"setting_id": row["setting_id"]}]

        if sql.startswith("UPDATE customers"):
            customer = self.customers.get(customer_id)
            if customer is None or customer["doh_alert_enabled"] == params["enabled"]:
                return []
            customer["doh_alert_enabled"] = params["enabled"]
            customer["doh_alert_updated_at"] = self.now
            return [{"customer_id": customer_id}]

        if "FROM customers" in sql and "FOR NO KEY UPDATE" in sql:
            return [{"customer_id": customer_id}] if customer_id in self.customers else []

        if "FROM current_settings" in sql:
            ids = [customer_id] if customer_id is not None else list(self.customers)
            rows = [self._view_row(i) for i in ids if i in self.customers]
            return sorted(rows, key=lambda row: row["customer_name"])

        if "COUNT(*) AS total FROM doh_settings" in sql:
            return [{"total": len(self._versions(customer_id))}]

        if "FROM doh_settings" in sql and "setting_id = :setting_id" in sql:
            return [
                row
                for row in self.settings
                if row["setting_id"] == params["setting_id"] and row["customer_id"] == customer_id
            ]

        if "FROM doh_settings" in sql and "LIMIT :limit" in sql:
            versions = self._versions(customer_id)
            return versions[params["offset"]:params["offset"] + params["limit"]]

        return []


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


def _save(min_doh="25", target_doh="30", max_doh="35", customer_id=1, updated_by=None):
    return doh_service.save_thresholds(
        customer_id,
        Decimal(min_doh),
        Decimal(target_doh),
        Decimal(max_doh),
        updated_by,
    )


# ---- current settings ----------------------------------------------------------


def test_settings_are_read_from_the_current_settings_view(monkeypatch):
    db = FakeDohDatabase({1: "fairprice", 2: "giant"})
    db.add_version(1, "25", "30", "35")
    conn = _install(monkeypatch, db)

    rows = doh_service.list_settings()

    assert [row["customer_name"] for row in rows] == ["fairprice", "giant"]
    assert rows[0]["target_doh"] == Decimal("30")
    assert len(conn.sql_containing("FROM current_settings")) == 1
    assert conn.sql_containing("FROM doh_settings") == []


def test_a_customer_without_thresholds_has_null_threshold_fields(monkeypatch):
    _install(monkeypatch, FakeDohDatabase({2: "giant"}))

    settings = doh_service.get_settings(2)

    assert settings["setting_id"] is None
    assert (settings["min_doh"], settings["target_doh"], settings["max_doh"]) == (None, None, None)
    assert settings["doh_alert_enabled"] is True


def test_timestamps_keep_their_timezone(monkeypatch):
    db = FakeDohDatabase()
    db.add_version(1, "25", "30", "35")
    _install(monkeypatch, db)

    settings = doh_service.get_settings(1)

    assert settings["doh_alert_updated_at"] == "2026-09-26T08:00:00+00:00"
    assert settings["thresholds_updated_at"].endswith("+00:00")


# ---- saving thresholds ----------------------------------------------------------


def test_saving_identical_thresholds_twice_creates_only_one_version(monkeypatch):
    db = FakeDohDatabase()
    _install(monkeypatch, db)

    first = _save()
    second = _save()

    assert first["changed"] is True
    assert second["changed"] is False
    assert len(db.settings) == 1
    assert second["settings"]["setting_id"] == db.settings[0]["setting_id"]


def test_changed_thresholds_append_a_version_and_keep_the_old_one(monkeypatch):
    db = FakeDohDatabase()
    old = db.add_version(1, "25", "30", "35")
    snapshot = dict(old)
    _install(monkeypatch, db)

    result = _save("20", "28", "40", updated_by="ops@aire")

    assert result["changed"] is True
    assert len(db.settings) == 2
    assert db.settings[0] == snapshot
    assert result["settings"]["target_doh"] == Decimal("28")
    assert result["settings"]["thresholds_updated_by"] == "ops@aire"


def test_the_save_is_one_conditional_insert_with_decimal_values(monkeypatch):
    conn = _install(monkeypatch, FakeDohDatabase())

    _save("25.50", "30", "35")

    [(sql, params)] = conn.sql_containing("INSERT INTO doh_settings")
    assert "WHERE NOT EXISTS" in sql
    assert "ORDER BY updated_at DESC, setting_id DESC LIMIT 1" in sql
    assert params["min_doh"] == Decimal("25.50")
    assert all(isinstance(params[key], Decimal) for key in ("min_doh", "target_doh", "max_doh"))


def test_the_customer_row_is_locked_before_the_insert(monkeypatch):
    conn = _install(monkeypatch, FakeDohDatabase())

    _save()

    statements = [sql for sql, _ in conn.calls]
    lock = next(i for i, sql in enumerate(statements) if "FOR NO KEY UPDATE" in sql)
    insert = next(i for i, sql in enumerate(statements) if sql.startswith("INSERT INTO doh_settings"))
    assert lock < insert


def test_saving_for_an_unknown_customer_writes_nothing(monkeypatch):
    db = FakeDohDatabase()
    conn = _install(monkeypatch, db)

    with pytest.raises(common.CustomerNotFoundError, match="9"):
        _save(customer_id=9)

    assert conn.sql_containing("INSERT INTO doh_settings") == []
    assert db.settings == []


# ---- DOH alert -------------------------------------------------------------------


def test_setting_the_doh_alert_creates_no_doh_settings_rows(monkeypatch):
    db = FakeDohDatabase()
    conn = _install(monkeypatch, db)

    result = doh_service.set_alert(1, False)

    assert result["changed"] is True
    assert result["settings"]["doh_alert_enabled"] is False
    assert db.settings == []
    assert conn.sql_containing("doh_settings") == []


def test_an_unchanged_alert_leaves_its_timestamp_alone(monkeypatch):
    db = FakeDohDatabase()
    conn = _install(monkeypatch, db)

    result = doh_service.set_alert(1, True)

    assert result["changed"] is False
    assert db.customers[1]["doh_alert_updated_at"] == STAMP
    [(sql, _)] = conn.sql_containing("UPDATE customers")
    assert "doh_alert_enabled IS DISTINCT FROM" in sql


def test_setting_the_alert_for_an_unknown_customer_updates_nothing(monkeypatch):
    conn = _install(monkeypatch, FakeDohDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        doh_service.set_alert(9, False)

    assert conn.sql_containing("UPDATE customers") == []


# ---- history ---------------------------------------------------------------------


def test_history_is_returned_newest_first(monkeypatch):
    db = FakeDohDatabase()
    db.add_version(1, "20", "25", "30", updated_at=STAMP)
    db.add_version(1, "25", "30", "35", updated_at=STAMP + timedelta(days=1))
    db.add_version(1, "30", "35", "40", updated_at=STAMP + timedelta(days=2))
    conn = _install(monkeypatch, db)

    history = doh_service.get_history(1, limit=20, offset=0)

    assert [item["setting_id"] for item in history["items"]] == [3, 2, 1]
    assert [item["is_current"] for item in history["items"]] == [True, False, False]
    assert history["total"] == 3
    [(sql, _)] = conn.sql_containing("LIMIT :limit")
    assert "ORDER BY updated_at DESC, setting_id DESC" in sql


def test_history_breaks_a_timestamp_tie_by_setting_id(monkeypatch):
    db = FakeDohDatabase()
    db.add_version(1, "20", "25", "30", updated_at=STAMP)
    db.add_version(1, "25", "30", "35", updated_at=STAMP)
    _install(monkeypatch, db)

    history = doh_service.get_history(1, limit=20, offset=0)

    assert [item["setting_id"] for item in history["items"]] == [2, 1]
    assert history["items"][0]["is_current"] is True


def test_history_pages_with_limit_and_offset(monkeypatch):
    db = FakeDohDatabase()
    for day in range(5):
        db.add_version(1, "20", str(25 + day), "40", updated_at=STAMP + timedelta(days=day))
    conn = _install(monkeypatch, db)

    page = doh_service.get_history(1, limit=2, offset=2)

    assert [item["setting_id"] for item in page["items"]] == [3, 2]
    assert (page["total"], page["limit"], page["offset"]) == (5, 2, 2)
    [(_, params)] = conn.sql_containing("LIMIT :limit")
    assert (params["limit"], params["offset"]) == (2, 2)


def test_history_of_an_unknown_customer_raises(monkeypatch):
    _install(monkeypatch, FakeDohDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        doh_service.get_history(9, limit=20, offset=0)


# ---- revert ----------------------------------------------------------------------


def test_revert_creates_a_new_version_rather_than_modifying_the_old_one(monkeypatch):
    db = FakeDohDatabase()
    db.add_version(1, "20", "25", "30", updated_at=STAMP - timedelta(days=2))
    db.add_version(1, "25", "30", "35", updated_at=STAMP - timedelta(days=1))
    before = [dict(row) for row in db.settings]
    _install(monkeypatch, db)

    result = doh_service.revert_to_version(1, 1, updated_by="ops@aire")

    assert result["changed"] is True
    assert db.settings[:2] == before
    new = db.settings[2]
    assert new["setting_id"] == 3
    assert (new["min_doh"], new["target_doh"], new["max_doh"]) == (Decimal("20"), Decimal("25"), Decimal("30"))
    assert result["settings"]["setting_id"] == 3


def test_reverting_to_the_values_already_current_writes_nothing(monkeypatch):
    db = FakeDohDatabase()
    db.add_version(1, "25", "30", "35")
    _install(monkeypatch, db)

    result = doh_service.revert_to_version(1, 1)

    assert result["changed"] is False
    assert len(db.settings) == 1


def test_revert_to_another_customers_version_is_not_found(monkeypatch):
    db = FakeDohDatabase({1: "fairprice", 2: "giant"})
    db.add_version(2, "25", "30", "35")
    conn = _install(monkeypatch, db)

    with pytest.raises(doh_service.SettingVersionNotFoundError, match="customer 1"):
        doh_service.revert_to_version(1, 1)

    assert conn.sql_containing("INSERT INTO doh_settings") == []


def test_revert_for_an_unknown_customer_raises(monkeypatch):
    _install(monkeypatch, FakeDohDatabase())

    with pytest.raises(common.CustomerNotFoundError):
        doh_service.revert_to_version(9, 1)
