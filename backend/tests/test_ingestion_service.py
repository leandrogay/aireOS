"""Upload versioning and rollback stay transactional and reversible."""

import datetime

import pytest
from fastapi import HTTPException

from app.routers import uploads as uploads_router
from app.schemas.uploads import RollbackUploadRequest
from app.services import ingestion_service


class FakeResult:
    def __init__(self, *, rows=None, scalar=None, rowcount=0):
        self.rows = rows or []
        self.scalar = scalar
        self.rowcount = rowcount

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def scalar_one(self):
        return self.scalar

    def __iter__(self):
        return iter(self.rows)


class FakeConnection:
    def __init__(self, run, versions=None):
        self.run = run
        self.versions = versions or []
        self.calls = []

    def execute(self, statement, parameters=None):
        sql = str(statement)
        self.calls.append((sql, parameters))
        if "FROM ingestion_runs" in sql and "FOR UPDATE" in sql:
            return FakeResult(rows=[self.run] if self.run else [])
        if "SELECT DISTINCT ON" in sql and "FROM sellout_versions" in sql:
            return FakeResult(rows=self.versions)
        if "DELETE FROM sellout AS current" in sql:
            return FakeResult(rowcount=2)
        return FakeResult()


class FakeTransaction:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, traceback):
        return False


class FakeEngine:
    def __init__(self, connection):
        self.connection = connection

    def begin(self):
        return FakeTransaction(self.connection)


def _run(status="completed"):
    return {
        "ingestion_id": 9,
        "source_blob": "uploads/bad.xlsx",
        "source_file": "bad.xlsx",
        "status": status,
        "rows_stored": 2,
        "loaded_at": datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc),
    }


def _baseline():
    return {
        "version_id": 1,
        "ingestion_id": None,
        "retailer_id": 57,
        "period_start": datetime.date(2026, 8, 1),
        "period_end": datetime.date(2026, 8, 31),
        "period_type": "month",
        "store_code": "420",
        "sku": "13255043",
        "quantity_units": 10.0,
        "revenue": 100.0,
        "source_file": "good.xlsx",
        "loaded_at": datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc),
        "data_source": "aireos_upload",
        "is_deleted": False,
    }


def test_record_versions_captures_absence_as_the_original_state():
    connection = FakeConnection(None)
    fact = _baseline()

    ingestion_service.record_versions(
        connection,
        9,
        [fact],
        replace_source=False,
    )

    baseline_sql, baseline_parameters = connection.calls[0]
    assert "LEFT JOIN sellout AS current" in baseline_sql
    assert "current.retailer_id IS NULL" in baseline_sql
    assert baseline_parameters[0]["sku"] == "13255043"


def test_rollback_marks_run_and_restores_latest_active_version():
    connection = FakeConnection(_run(), [_baseline()])

    result = ingestion_service.rollback_upload(
        "uploads/bad.xlsx",
        rolled_back_by="staff@shop-aire.com",
        reason="Wrong customer",
        engine=FakeEngine(connection),
    )

    assert result == {
        "ingestion_id": 9,
        "source_blob": "uploads/bad.xlsx",
        "source_file": "bad.xlsx",
        "status": "rolled_back",
        "rows_affected": 2,
        "rows_restored": 1,
        "rows_removed": 1,
    }
    update = next(call for call in connection.calls if "status = 'rolled_back'" in call[0])
    assert update[1]["rolled_back_by"] == "staff@shop-aire.com"
    assert update[1]["reason"] == "Wrong customer"
    assert any("INSERT INTO sellout (" in sql for sql, _ in connection.calls)


def test_rollback_of_unknown_upload_does_not_change_sellout():
    connection = FakeConnection(None)

    with pytest.raises(ingestion_service.IngestionNotFoundError):
        ingestion_service.rollback_upload(
            "uploads/missing.xlsx",
            rolled_back_by="staff@shop-aire.com",
            engine=FakeEngine(connection),
        )

    assert not any("DELETE FROM sellout" in sql for sql, _ in connection.calls)


def test_rollback_is_idempotently_rejected():
    connection = FakeConnection(_run("rolled_back"))

    with pytest.raises(ingestion_service.IngestionAlreadyRolledBackError):
        ingestion_service.rollback_upload(
            "uploads/bad.xlsx",
            rolled_back_by="staff@shop-aire.com",
            engine=FakeEngine(connection),
        )

    assert not any("DELETE FROM sellout" in sql for sql, _ in connection.calls)


def test_rollback_route_records_the_signed_in_user(monkeypatch):
    captured = {}

    def rollback(source_blob, *, rolled_back_by, reason):
        captured.update(
            source_blob=source_blob,
            rolled_back_by=rolled_back_by,
            reason=reason,
        )
        return {"status": "rolled_back"}

    monkeypatch.setattr(ingestion_service, "rollback_upload", rollback)

    result = uploads_router.rollback_upload(
        RollbackUploadRequest(blob_path=" uploads/bad.xlsx ", reason=" Wrong customer "),
        user={"email": "staff@shop-aire.com"},
    )

    assert result == {"status": "rolled_back"}
    assert captured == {
        "source_blob": "uploads/bad.xlsx",
        "rolled_back_by": "staff@shop-aire.com",
        "reason": "Wrong customer",
    }


def test_rollback_route_returns_conflict_for_an_already_rolled_back_upload(monkeypatch):
    def rollback(*args, **kwargs):
        raise ingestion_service.IngestionAlreadyRolledBackError("Already rolled back.")

    monkeypatch.setattr(ingestion_service, "rollback_upload", rollback)

    with pytest.raises(HTTPException) as exc_info:
        uploads_router.rollback_upload(
            RollbackUploadRequest(blob_path="uploads/bad.xlsx"),
            user={"email": "staff@shop-aire.com"},
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Already rolled back."
