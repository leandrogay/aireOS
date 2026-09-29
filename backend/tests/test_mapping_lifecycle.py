"""
What happens to a mapping, and to the uploads behind it, when it is approved.

The contract moves from mappings/pending/ to mappings/confirmed/, and every
file already uploaded against it stops being "awaiting review". Both are easy
to half-do -- a confirmed copy written while the pending one lingers, or a
history that keeps reporting a state that stopped being true -- so both are
pinned here.
"""

import datetime

from app.routers import uploads as uploads_router
from app.services import mapping_view as mv
from app.services import storage


class FakeBlob:
    def __init__(self, name, metadata=None):
        self.name = name
        self.metadata = metadata or {}
        self.time_created = datetime.datetime(2026, 9, 1, 12, 0, 0)
        self.size = 10
        self.deleted = False
        self.patched = 0
        self.data = None

    def exists(self):
        return not self.deleted

    def upload_from_string(self, data, content_type=None):
        self.data = data
        self.deleted = False

    def download_as_bytes(self):
        return self.data.encode() if isinstance(self.data, str) else self.data

    def delete(self):
        self.deleted = True

    def patch(self):
        self.patched += 1


class FakeBucket:
    def __init__(self, client):
        self._client = client

    def blob(self, name):
        return self._client.get_or_create(name)


class FakeStorageClient:
    def __init__(self, blobs=None):
        self.blobs = {blob.name: blob for blob in (blobs or [])}

    def get_or_create(self, name):
        if name not in self.blobs:
            blob = FakeBlob(name)
            blob.deleted = True  # not written yet, so it does not exist
            self.blobs[name] = blob
        return self.blobs[name]

    def list_blobs(self, bucket_name, prefix=None):
        return [
            blob
            for blob in self.blobs.values()
            if not blob.deleted and (prefix is None or blob.name.startswith(prefix))
        ]

    def bucket(self, bucket_name):
        return FakeBucket(self)


def _install(monkeypatch, blobs=None):
    client = FakeStorageClient(blobs)
    monkeypatch.setattr(storage, "get_storage_client", lambda: client)
    return client


def _upload_blob(name, fingerprint=None, status=None):
    metadata = {storage.ORIGINAL_FILENAME_METADATA_KEY: name}
    if fingerprint:
        metadata[storage.MAPPING_FINGERPRINT_METADATA_KEY] = fingerprint
    if status:
        metadata[storage.MAPPING_STATUS_METADATA_KEY] = status
    return FakeBlob(f"{storage.DESTINATION_PREFIX}2026-09-01_120000_{name}", metadata)


# ---- pending -> confirmed ----------------------------------------------------

def test_approval_writes_confirmed_and_removes_pending(monkeypatch):
    client = _install(monkeypatch)
    pending_path = storage.pending_mapping_path("abc123")
    client.blobs[pending_path] = FakeBlob(pending_path)

    result = storage.move_pending_mapping_to_confirmed("abc123", {"contract": {}})

    assert result["confirmed_path"] == "mappings/confirmed/abc123.json"
    assert result["pending_path"] == pending_path
    assert result["removed_pending"] is True
    assert client.blobs[pending_path].deleted is True
    assert client.blobs["mappings/confirmed/abc123.json"].data is not None


def test_approval_succeeds_when_there_was_no_pending_blob(monkeypatch):
    # Amending an already-confirmed mapping: its pending copy was cleaned up
    # the first time round, and its absence is not a failure.
    _install(monkeypatch)

    result = storage.move_pending_mapping_to_confirmed("abc123", {"contract": {}})

    assert result["removed_pending"] is False
    assert result["pending_error"] is None
    assert result["stored_at"].endswith("mappings/confirmed/abc123.json")


def test_confirmed_copy_is_written_before_the_pending_one_is_removed(monkeypatch):
    # If the delete fails, the contract must still exist somewhere.
    client = _install(monkeypatch)
    pending_path = storage.pending_mapping_path("abc123")
    client.blobs[pending_path] = FakeBlob(pending_path)

    def explode():
        raise RuntimeError("delete denied")

    client.blobs[pending_path].delete = explode

    result = storage.move_pending_mapping_to_confirmed("abc123", {"contract": {}})

    assert result["removed_pending"] is False
    assert "delete denied" in result["pending_error"]
    assert client.blobs["mappings/confirmed/abc123.json"].data is not None


# ---- the uploads behind the mapping ------------------------------------------

def test_approval_restamps_only_the_uploads_that_used_that_mapping(monkeypatch):
    mine = _upload_blob("week01.txt", "abc123", "pending_confirmation")
    other = _upload_blob("other.txt", "zzz999", "pending_confirmation")
    unmapped = _upload_blob("stray.txt")
    _install(monkeypatch, [mine, other, unmapped])

    result = storage.update_uploads_for_mapping(
        "abc123",
        {
            storage.MAPPING_STATUS_METADATA_KEY: "mapped",
            storage.MAPPING_NAME_METADATA_KEY: "XEL weekly",
        },
    )

    assert result["matched"] == [mine.name]
    assert result["updated"] == [mine.name]
    assert mine.metadata[storage.MAPPING_STATUS_METADATA_KEY] == "mapped"
    assert mine.metadata[storage.MAPPING_NAME_METADATA_KEY] == "XEL weekly"
    # Untouched, including the one with no mapping at all.
    assert other.metadata[storage.MAPPING_STATUS_METADATA_KEY] == "pending_confirmation"
    assert storage.MAPPING_STATUS_METADATA_KEY not in unmapped.metadata


def test_restamping_keeps_the_metadata_it_was_not_asked_to_change(monkeypatch):
    blob = _upload_blob("week01.txt", "abc123", "pending_confirmation")
    _install(monkeypatch, [blob])

    storage.update_uploads_for_mapping(
        "abc123", {storage.MAPPING_STATUS_METADATA_KEY: "mapped"}
    )

    assert blob.metadata[storage.ORIGINAL_FILENAME_METADATA_KEY] == "week01.txt"
    assert blob.metadata[storage.MAPPING_FINGERPRINT_METADATA_KEY] == "abc123"


def test_history_reports_the_mapping_name_once_there_is_one(monkeypatch):
    blob = _upload_blob("week01.txt", "abc123", "mapped")
    blob.metadata[storage.MAPPING_NAME_METADATA_KEY] = "XEL weekly"
    _install(monkeypatch, [blob])

    row = storage.list_uploads()[0]

    assert row["mapping_name"] == "XEL weekly"
    assert row["mapping_status"] == "mapped"
    assert row["mapping_fingerprint"] == "abc123"


# ---- what gets recorded on the upload in the first place ---------------------

def test_a_partial_match_records_no_fingerprint_to_link_to():
    # Its fingerprint is the new layout's, and nothing is filed under it, so a
    # "View mapping" link built from it would 404.
    annotations = uploads_router._mapping_annotations(
        {"status": "partial_match", "fingerprint": "newlayout", "matched": {}}
    )

    assert annotations[storage.MAPPING_STATUS_METADATA_KEY] == "partial_match"
    assert storage.MAPPING_FINGERPRINT_METADATA_KEY not in annotations


def test_a_pending_proposal_records_the_fingerprint_it_is_stored_under():
    annotations = uploads_router._mapping_annotations(
        {"status": "pending_confirmation", "fingerprint": "abc123"}
    )

    assert annotations[storage.MAPPING_FINGERPRINT_METADATA_KEY] == "abc123"


def test_a_builtin_match_records_its_mapping_id_name_and_vendor():
    annotations = uploads_router._mapping_annotations(
        {
            "status": "mapped",
            "mapping_id": mv.BUILTIN_MAPPING_ID,
            "name": mv.BUILTIN_MAPPING_NAME,
            "vendor": mv.BUILTIN_MAPPING_VENDOR,
        }
    )

    assert annotations[storage.MAPPING_FINGERPRINT_METADATA_KEY] == mv.BUILTIN_MAPPING_ID
    assert annotations[storage.MAPPING_NAME_METADATA_KEY] == mv.BUILTIN_MAPPING_NAME
    assert annotations[storage.VENDOR_METADATA_KEY] == mv.BUILTIN_MAPPING_VENDOR


# ---- the coverage checklist ---------------------------------------------------

def test_every_coverage_field_is_a_field_a_contract_can_actually_fill():
    # The checklist is sent to the review screen as the set of fields it may
    # ask someone to allocate. A name the contract's schema does not accept
    # would be a field nobody can ever tick off.
    from app.services import generate_mapping

    for field in mv.CORE_TARGET_FIELDS:
        assert field in generate_mapping.TARGET_SCHEMA
        assert field in mv.BUILTIN_TARGET_SCHEMA


def test_period_fields_are_declared_as_filled_without_a_column():
    assert set(mv.PERIOD_DERIVED_FIELDS) <= set(mv.CORE_TARGET_FIELDS)
    assert mv.PERIOD_DERIVED_FIELDS == ["period_start", "period_end", "period_type"]


def test_both_packets_carry_the_same_checklist():
    envelope = {
        "contract": {"identity_mapping": {"SKU": "sku"}, "melt_groups": []},
        "raw_columns": ["SKU"],
        "target_schema": ["sku"],
    }

    builtin = mv.builtin_packet()
    stored = mv.envelope_to_packet("abc123", envelope, "pending")

    assert builtin["coverageFields"] == mv.CORE_TARGET_FIELDS
    assert stored["coverageFields"] == mv.CORE_TARGET_FIELDS
    assert builtin["periodDerivedFields"] == stored["periodDerivedFields"]
