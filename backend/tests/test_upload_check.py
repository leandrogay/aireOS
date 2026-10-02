"""
The pre-upload check behind POST /api/uploads/check.

It answers "what will happen to this file?" the moment it is dropped, so the
upload screen can sort files into ready / needs a decision before anything is
sent. The promise that makes that safe is that it is read-only: it never
writes to the bucket and never asks Claude for a mapping. Both are pinned here
alongside the answers themselves.
"""

import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import generate_mapping, storage, upload_check

client = TestClient(app)

CSV = b"SKU No.,Store Code,Sales\n123,420,10\n"


class FakeBlob:
    def __init__(self, name, metadata, time_created=None):
        self.name = name
        self.metadata = metadata
        self.time_created = time_created


class FakeStorageClient:
    def __init__(self, blobs=None):
        self.blobs = blobs or []

    def list_blobs(self, bucket_name, prefix=None):
        return list(self.blobs)


def _install(monkeypatch, blobs=None, confirmed=None, partial=None):
    """Fake bucket listing, stored contracts and partial matching; no writes allowed."""
    monkeypatch.setattr(storage, "get_storage_client", lambda: FakeStorageClient(blobs))
    monkeypatch.setattr(
        storage,
        "download_json",
        lambda path: confirmed
        if confirmed and path.startswith(f"{storage.MAPPING_PREFIX}confirmed/")
        else None,
    )
    monkeypatch.setattr(generate_mapping, "find_partial_match", lambda columns: partial)

    def _no_writes(*args, **kwargs):
        raise AssertionError("the pre-upload check must not write")

    def _no_claude(*args, **kwargs):
        raise AssertionError("the pre-upload check must not call Claude")

    monkeypatch.setattr(storage, "upload_json", _no_writes)
    monkeypatch.setattr(generate_mapping, "generate_mapping_contract", _no_claude)


# ---- Mapping preview ---------------------------------------------------------

def test_known_layout_reports_the_mapping_it_will_use(monkeypatch):
    _install(monkeypatch, confirmed={"name": "XEL monthly", "vendor": "Fairprice"})

    result = upload_check.check_file("sales.csv", CSV)

    assert result["error"] is None
    assert result["mapping"]["status"] == "mapped"
    assert result["mapping"]["name"] == "XEL monthly"
    assert result["mapping"]["vendor"] == "Fairprice"


def test_near_match_reports_the_mapping_it_resembles(monkeypatch):
    partial = {"fingerprint": "abc", "name": "XEL monthly", "missing_columns": ["Brand"]}
    _install(monkeypatch, partial=partial)

    result = upload_check.check_file("sales.csv", CSV)

    assert result["mapping"]["status"] == "partial_match"
    assert result["mapping"]["matched"] == partial


def test_new_layout_is_reported_without_generating_or_storing_a_mapping(monkeypatch):
    _install(monkeypatch)

    result = upload_check.check_file("sales.csv", CSV)

    assert result["mapping"]["status"] == "new_layout"
    assert result["mapping"]["fingerprint"] == generate_mapping.fingerprint(
        ["SKU No.", "Store Code", "Sales"]
    )


# ---- Duplicates --------------------------------------------------------------

def test_same_contents_are_reported_as_a_duplicate_with_when_and_as_what(monkeypatch):
    uploaded_at = datetime.datetime(2026, 10, 2, 15, 18, tzinfo=datetime.timezone.utc)
    earlier = FakeBlob(
        "uploads/2026-10-02_151800_old-name.csv",
        {
            storage.ORIGINAL_FILENAME_METADATA_KEY: "old-name.csv",
            storage.CONTENT_HASH_METADATA_KEY: storage.content_digest(CSV),
        },
        uploaded_at,
    )
    _install(monkeypatch, blobs=[earlier])

    result = upload_check.check_file("sales.csv", CSV)

    assert result["duplicate"] == {
        "matched_on": "content",
        "existing_filename": "old-name.csv",
        "existing_uploaded_at": "2026-10-02T15:18:00+00:00",
    }


def test_a_file_seen_before_only_by_name_is_a_filename_duplicate(monkeypatch):
    earlier = FakeBlob(
        "uploads/2026-10-01_090000_sales.csv",
        {storage.ORIGINAL_FILENAME_METADATA_KEY: "sales.csv"},
    )
    _install(monkeypatch, blobs=[earlier])

    result = upload_check.check_file("sales.csv", CSV)

    assert result["duplicate"]["matched_on"] == "filename"
    assert result["duplicate"]["existing_uploaded_at"] is None


def test_a_new_file_is_not_a_duplicate_and_carries_its_content_hash(monkeypatch):
    _install(monkeypatch)

    result = upload_check.check_file("sales.csv", CSV)

    assert result["duplicate"] is None
    assert result["content_hash"] == storage.content_digest(CSV)


# ---- Files that cannot be uploaded ------------------------------------------

def test_disallowed_extension_is_an_error_and_nothing_else_is_checked(monkeypatch):
    def _no_client():
        raise AssertionError("an invalid file should not reach the bucket")

    monkeypatch.setattr(storage, "get_storage_client", _no_client)

    result = upload_check.check_file("notes.pdf", b"%PDF")

    assert "isn't a supported file type" in result["error"]
    assert result["mapping"] is None
    assert result["duplicate"] is None


def test_unreadable_file_is_an_error_and_is_not_checked_for_duplicates(monkeypatch):
    def _no_client():
        raise AssertionError("an unreadable file should not reach the bucket")

    monkeypatch.setattr(storage, "get_storage_client", _no_client)

    result = upload_check.check_file("broken.xlsx", b"not a workbook")

    assert result["error"] == upload_check.UNREADABLE_MESSAGE
    assert result["mapping"] is None


# ---- Route -------------------------------------------------------------------

def test_check_route_returns_one_result_per_file(monkeypatch):
    monkeypatch.setattr(
        upload_check,
        "check_files",
        lambda files: [{"filename": name} for name, _ in files],
    )

    response = client.post(
        "/api/uploads/check",
        files=[("files", ("a.csv", CSV)), ("files", ("b.csv", CSV))],
    )

    assert response.status_code == 200
    assert response.json() == {"results": [{"filename": "a.csv"}, {"filename": "b.csv"}]}


@pytest.mark.parametrize(
    "error",
    [storage.GCSConfigError("no bucket"), storage.GCSPermissionError("denied")],
)
def test_check_route_reports_an_unreachable_bucket_as_503(monkeypatch, error):
    def _fail(files):
        raise error

    monkeypatch.setattr(upload_check, "check_files", _fail)

    response = client.post("/api/uploads/check", files=[("files", ("a.csv", CSV))])

    assert response.status_code == 503
    assert "Unable to check files" in response.json()["detail"]
