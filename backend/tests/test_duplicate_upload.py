import datetime

import pytest

from app.services import storage


class FakeBlob:
    def __init__(self, name, metadata=None, time_created=None):
        self.name = name
        self.metadata = metadata or {}
        self.time_created = time_created
        self.deleted = False
        self.uploaded_data = None
        self.content_type = None

    def upload_from_string(self, data, content_type=None):
        self.uploaded_data = data
        self.content_type = content_type

    def delete(self):
        self.deleted = True


class FakeBucket:
    def __init__(self, client):
        self._client = client

    def blob(self, name):
        blob = FakeBlob(name)
        self._client.blobs.append(blob)
        return blob


class FakeStorageClient:
    """
    Stand-in for google.cloud.storage.Client. `blobs` holds both the
    pre-seeded "already uploaded" blobs and anything uploaded during the
    test, so list_blobs() reflects uploads made earlier in the same test
    (matching the assumption upload_many's sequential duplicate check
    relies on). Deleted blobs are excluded, same as real GCS after delete().
    """

    def __init__(self, existing_blobs=None):
        self.blobs = list(existing_blobs or [])

    def list_blobs(self, bucket_name, prefix=None):
        return [b for b in self.blobs if not b.deleted]

    def bucket(self, bucket_name):
        return FakeBucket(self)


def _existing_blob(safe_name, uploaded_at=None):
    return FakeBlob(
        name=f"uploads/2026-08-01_120000_{safe_name}",
        metadata={storage.ORIGINAL_FILENAME_METADATA_KEY: safe_name},
        time_created=uploaded_at or datetime.datetime(2026, 8, 1, 12, 0, 0),
    )


def _install_fake_client(monkeypatch, existing_blobs=None):
    fake_client = FakeStorageClient(existing_blobs)
    monkeypatch.setattr(storage, "get_storage_client", lambda: fake_client)
    return fake_client


# ---- Single-file duplicate detection -------------------------------------------

def test_exact_filename_reupload_is_rejected_without_force(monkeypatch):
    existing = _existing_blob("sales_aug.csv")
    _install_fake_client(monkeypatch, [existing])

    result = storage.upload_file_bytes("sales_aug.csv", b"new bytes", force=False)

    assert result["success"] is False
    assert result["duplicate"] is True
    assert result["reason"] == "duplicate"
    assert result["existing_destination"] == f"gs://{storage.BUCKET_NAME}/{existing.name}"
    assert result["existing_uploaded_at"] == existing.time_created.isoformat()


def test_reupload_with_force_replaces_the_old_blob(monkeypatch):
    existing = _existing_blob("sales_aug.csv")
    fake_client = _install_fake_client(monkeypatch, [existing])

    result = storage.upload_file_bytes("sales_aug.csv", b"new bytes", force=True)

    assert result["success"] is True
    assert result["replaced"] is True
    assert existing.deleted is True
    # the new blob is uploaded (and visible) before the old one is removed
    live_names = {b.name for b in fake_client.blobs if not b.deleted}
    assert existing.name not in live_names


def test_force_upload_writes_new_blob_rather_than_overwriting_the_old_one(monkeypatch):
    existing = _existing_blob("sales_aug.csv")
    _install_fake_client(monkeypatch, [existing])

    result = storage.upload_file_bytes("sales_aug.csv", b"new bytes", force=True)

    # Uploaded data lands on a *new* timestamped blob, not the old one.
    assert result["destination"] != f"gs://{storage.BUCKET_NAME}/{existing.name}"
    assert existing.uploaded_data is None


def test_duplicate_check_is_case_sensitive(monkeypatch):
    # Documents a real gap: "Sales.csv" and "sales.csv" are NOT deduped
    # against each other, since matching is a plain string equality on the
    # stored original_filename metadata.
    existing = _existing_blob("Sales.csv")
    _install_fake_client(monkeypatch, [existing])

    result = storage.upload_file_bytes("sales.csv", b"new bytes", force=False)

    assert result["success"] is True
    assert "duplicate" not in result


def test_different_filename_same_content_is_not_caught(monkeypatch):
    # Documents another gap: dedup is filename-only, so the same bytes
    # uploaded under a different name is never flagged.
    existing = _existing_blob("sales_aug.csv")
    fake_client = _install_fake_client(monkeypatch, [existing])
    existing.uploaded_data = b"identical content"

    result = storage.upload_file_bytes("sales_aug_v2.csv", b"identical content", force=False)

    assert result["success"] is True
    assert "duplicate" not in result
    assert len([b for b in fake_client.blobs if not b.deleted]) == 2


def test_no_existing_upload_succeeds_normally(monkeypatch):
    _install_fake_client(monkeypatch, [])

    result = storage.upload_file_bytes("first_upload.csv", b"data", force=False)

    assert result["success"] is True
    assert result["replaced"] is False


def test_disallowed_extension_is_rejected_before_any_gcs_call(monkeypatch):
    def _boom():
        raise AssertionError("get_storage_client should not be called for an invalid extension")

    monkeypatch.setattr(storage, "get_storage_client", _boom)

    with pytest.raises(storage.InvalidFileTypeError):
        storage.upload_file_bytes("malware.exe", b"data", force=False)


# ---- Batch uploads ---------------------------------------------------------------

def test_batch_flags_duplicate_against_pre_existing_upload(monkeypatch):
    existing = _existing_blob("sales_aug.csv")
    _install_fake_client(monkeypatch, [existing])

    result = storage.upload_many(
        [("sales_aug.csv", b"a"), ("sales_sep.csv", b"b")], force=False
    )

    assert result["uploaded"] == 1
    assert result["duplicates"] == 1
    assert result["failed"] == 0
    assert result["results"][0]["reason"] == "duplicate"
    assert result["results"][1]["success"] is True


def test_batch_with_internal_duplicate_pair_flags_the_second_occurrence(monkeypatch):
    # Two files with the identical name in the same batch: the first upload
    # becomes visible to the second's duplicate check (sequential, not a
    # batch-wide pre-scan), so only the second is flagged.
    _install_fake_client(monkeypatch, [])

    result = storage.upload_many(
        [("weekly.csv", b"first"), ("weekly.csv", b"second")], force=False
    )

    assert result["uploaded"] == 1
    assert result["duplicates"] == 1
    assert result["results"][0]["success"] is True
    assert result["results"][1]["reason"] == "duplicate"


def test_batch_duplicate_does_not_block_other_files(monkeypatch):
    existing = _existing_blob("sales_aug.csv")
    _install_fake_client(monkeypatch, [existing])

    result = storage.upload_many(
        [("sales_aug.csv", b"a"), ("sales_sep.csv", b"b"), ("sales_oct.csv", b"c")],
        force=False,
    )

    assert result["uploaded"] == 2
    assert result["duplicates"] == 1
    assert [r["success"] for r in result["results"]] == [False, True, True]


def test_batch_summary_counts_match_individual_results(monkeypatch):
    existing_a = _existing_blob("a.csv")
    existing_b = _existing_blob("b.csv")
    _install_fake_client(monkeypatch, [existing_a, existing_b])

    result = storage.upload_many(
        [("a.csv", b"1"), ("b.csv", b"2"), ("c.csv", b"3"), ("d.csv", b"4"), ("e.csv", b"5")],
        force=False,
    )

    assert result["duplicates"] == 2
    assert result["uploaded"] == 3
    assert result["failed"] == 0
    assert result["success"] is False  # not every file in the batch uploaded
