"""
Loading uploaded files into sell-out as its own step, after approval.

Approval marks the files behind a mapping as loadable and loads nothing; a
load previews first, then writes with the current version of the mapping and
records that version. These pin the states each file moves through, that a
file which is not approved never reaches the transformation, and the status
codes of the two endpoints.
"""

import datetime

import pandas as pd
from fastapi.testclient import TestClient

from app.main import app
from app.routers import uploads as uploads_router
from app.services import sellout_ingestion, sellout_service, storage, upload_loading

client = TestClient(app)

CONTRACT = {"version": 2, "fields": {}}
ENVELOPE = {"name": "XEL weekly", "vendor": "xel", "version": 3, "contract": CONTRACT}


def _upload(blob_path, status, version=None, fingerprint="fp"):
    return {
        "blob_path": blob_path,
        "filename": blob_path.rsplit("/", 1)[-1],
        "uploaded_at": "2026-10-01T00:00:00+00:00",
        "mapping_fingerprint": fingerprint,
        "mapping_status": status,
        "mapping_version": version,
        "mapping_name": "XEL weekly",
    }


class FakeBucket:
    """Uploads and confirmed mappings by path; records every annotation."""

    def __init__(self, uploads, envelopes=None):
        self.uploads = {upload["blob_path"]: upload for upload in uploads}
        self.envelopes = envelopes if envelopes is not None else {storage.confirmed_mapping_path("fp"): ENVELOPE}
        self.annotations = {}

    def install(self, monkeypatch):
        monkeypatch.setattr(storage, "list_uploads_for_mapping", lambda fingerprint: list(self.uploads.values()))
        monkeypatch.setattr(storage, "get_upload", self.uploads.get)
        monkeypatch.setattr(storage, "download_json", self.envelopes.get)
        monkeypatch.setattr(
            storage,
            "download_upload",
            lambda path: (self.uploads[path]["filename"], b"bytes") if path in self.uploads else None,
        )
        monkeypatch.setattr(storage, "annotate_upload", self.annotate)
        return self

    def annotate(self, blob_path, annotations):
        self.annotations.setdefault(blob_path, {}).update(annotations)
        return True


def _no_transform_allowed(*args, **kwargs):
    raise AssertionError("a file that cannot be loaded must not be transformed")


# ---- After an approval ------------------------------------------------------------


def test_approval_makes_unloaded_files_ready_and_lists_them_as_waiting(monkeypatch):
    bucket = FakeBucket([_upload("uploads/a.txt", "pending_confirmation")]).install(monkeypatch)

    result = upload_loading.mark_uploads_after_approval("fp", name="XEL weekly", vendor="xel", version=1)

    assert [item["blob_path"] for item in result["waiting"]] == ["uploads/a.txt"]
    assert result["outdated"] == []
    assert bucket.annotations["uploads/a.txt"][storage.MAPPING_STATUS_METADATA_KEY] == "ready_to_load"
    assert bucket.annotations["uploads/a.txt"][storage.MAPPING_NAME_METADATA_KEY] == "XEL weekly"


def test_a_new_version_offers_a_reload_for_files_loaded_with_an_older_one(monkeypatch):
    bucket = FakeBucket(
        [
            _upload("uploads/old.txt", "mapped", version="2"),
            # Loaded before versions were recorded: which version is unknown.
            _upload("uploads/legacy.txt", "mapped"),
            _upload("uploads/current.txt", "mapped", version="3"),
        ]
    ).install(monkeypatch)

    result = upload_loading.mark_uploads_after_approval("fp", name="XEL weekly", vendor="xel", version=3)

    assert [item["blob_path"] for item in result["outdated"]] == ["uploads/old.txt", "uploads/legacy.txt"]
    assert result["waiting"] == []
    assert bucket.annotations["uploads/current.txt"][storage.MAPPING_STATUS_METADATA_KEY] == "mapped"


# ---- Preview ------------------------------------------------------------------------


def test_preview_runs_the_dry_run_with_the_approved_contract(monkeypatch):
    FakeBucket([_upload("uploads/a.txt", "ready_to_load")]).install(monkeypatch)
    calls = []

    def preview(filename, data, contract, *, replace_source=False):
        calls.append((filename, contract, replace_source))
        return {"rows_to_store": 4, "overwrites": []}

    monkeypatch.setattr(sellout_ingestion, "preview_confirmed_upload", preview)

    [result] = upload_loading.preview_loads(["uploads/a.txt"])

    assert result["success"] is True
    assert result["preview"]["rows_to_store"] == 4
    assert result["mapping_version"] == 3
    assert calls == [("a.txt", CONTRACT, True)]


def test_a_file_whose_mapping_is_not_approved_is_never_transformed(monkeypatch):
    FakeBucket([_upload("uploads/a.txt", "pending_confirmation")]).install(monkeypatch)
    monkeypatch.setattr(sellout_ingestion, "preview_confirmed_upload", _no_transform_allowed)

    [result] = upload_loading.preview_loads(["uploads/a.txt"])

    assert result["success"] is False
    assert "not been approved" in result["error"]


def test_a_file_already_loaded_with_the_current_version_is_not_offered_again(monkeypatch):
    FakeBucket([_upload("uploads/a.txt", "mapped", version="3")]).install(monkeypatch)
    monkeypatch.setattr(sellout_ingestion, "preview_confirmed_upload", _no_transform_allowed)

    [result] = upload_loading.preview_loads(["uploads/a.txt"])

    assert result["success"] is False
    assert "already loaded" in result["error"]


# ---- Load ---------------------------------------------------------------------------


def test_loading_stamps_the_file_as_loaded_with_the_current_version(monkeypatch):
    bucket = FakeBucket([_upload("uploads/a.txt", "reload_available", version="2")]).install(monkeypatch)
    calls = []

    def process(filename, data, contract, *, replace_source=False):
        calls.append(replace_source)
        return {"rows_stored": 4, "storage_status": "completed"}

    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", process)

    [result] = upload_loading.load_uploads(["uploads/a.txt"])

    assert result["success"] is True
    assert result["reload"] is True
    # A reload replaces the rows the older version wrote for this file.
    assert calls == [True]
    assert bucket.annotations["uploads/a.txt"] == {
        storage.MAPPING_STATUS_METADATA_KEY: "mapped",
        storage.MAPPING_VERSION_METADATA_KEY: "3",
    }


def test_one_file_failing_to_load_leaves_the_others_to_load(monkeypatch):
    bucket = FakeBucket(
        [_upload("uploads/bad.txt", "ready_to_load"), _upload("uploads/good.txt", "ready_to_load")]
    ).install(monkeypatch)

    def process(filename, data, contract, *, replace_source=False):
        if filename == "bad.txt":
            raise sellout_service.SelloutLoadError("Cloud SQL sell-out load failed: down")
        return {"rows_stored": 4, "storage_status": "completed"}

    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", process)

    bad, good = upload_loading.load_uploads(["uploads/bad.txt", "uploads/good.txt"])

    assert (bad["success"], good["success"]) == (False, True)
    assert "down" in bad["error"]
    assert "uploads/bad.txt" not in bucket.annotations


# ---- What a load would overwrite -----------------------------------------------------


class FakeResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def scalar_one(self):
        return self._scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows


class FakeReadEngine:
    """Answers the two overlap queries with canned rows; records parameters."""

    def __init__(self, existing, same_file_rows=0):
        self.existing = existing
        self.same_file_rows = same_file_rows
        self.parameters = []

    def connect(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, parameters):
        self.parameters.append(parameters)
        if "COUNT(*)" in str(statement):
            return FakeResult(scalar=self.same_file_rows)
        return FakeResult(rows=self.existing)


def _rows_to_load():
    return pd.DataFrame(
        [
            {
                "retailer": "xel_offline",
                "store_code": "420",
                "sku": "13255043",
                "period_start": "2026-08-01",
                "period_end": "2026-08-31",
                "period_type": "month",
                "quantity_units": 2.0,
                "revenue": 10.0,
                "source_file": "aug.txt",
            }
        ]
    )


def _existing(source_file, sku="13255043"):
    return {
        "retailer_name": "xel_offline",
        "store_code": "420",
        "sku": sku,
        "period_start": datetime.date(2026, 8, 1),
        "period_type": "month",
        "source_file": source_file,
    }


def test_the_dry_run_returns_sample_rows_and_writes_nothing(monkeypatch):
    monkeypatch.setenv("CLOUD_SQL_LOAD_ENABLED", "false")
    monkeypatch.setattr(sellout_ingestion, "transform_confirmed_upload", lambda *args: _rows_to_load())
    monkeypatch.setattr(sellout_service, "load_clean_rows", _no_transform_allowed)

    preview = sellout_ingestion.preview_confirmed_upload("aug.txt", b"bytes", CONTRACT)

    assert preview["rows_to_store"] == 1
    assert preview["period_types"] == ["month"]
    assert preview["preview"][0]["sku"] == "13255043"
    assert "revenue" in preview["columns"]


def test_overlap_counts_rows_other_files_loaded_under_the_same_key():
    engine = FakeReadEngine([_existing("july_resend.txt"), _existing("other.txt", sku="99999999")])

    overlap = sellout_service.existing_overlap(_rows_to_load(), engine=engine)

    assert overlap == {"rows_replaced": 0, "overwrites": [{"source_file": "july_resend.txt", "rows": 1}]}
    assert engine.parameters[-1]["retailer_names"] == ["xel_offline"]


def test_rows_from_a_same_named_file_count_as_replaced_not_overwritten():
    engine = FakeReadEngine([_existing("aug.txt")], same_file_rows=12)

    overlap = sellout_service.existing_overlap(_rows_to_load(), replace_source=True, engine=engine)

    assert overlap == {"rows_replaced": 12, "overwrites": []}


# ---- Feature flag: known layouts wait for a confirmed load -----------------------------


def test_with_the_flag_on_a_known_layout_is_left_ready_to_load(monkeypatch):
    monkeypatch.setenv("REQUIRE_LOAD_CONFIRMATION", "true")
    monkeypatch.setattr(
        uploads_router.generate_mapping,
        "resolve_mapping",
        lambda *_: {"status": "mapped", "fingerprint": "fp", "contract": CONTRACT, "version": 3},
    )
    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", _no_transform_allowed)

    result = uploads_router.resolve_and_apply_mapping("aug.txt", b"bytes")

    assert result["status"] == "ready_to_load"
    annotations = uploads_router._mapping_annotations(result)
    assert annotations[storage.MAPPING_FINGERPRINT_METADATA_KEY] == "fp"
    assert storage.MAPPING_VERSION_METADATA_KEY not in annotations


def test_a_file_loaded_on_upload_records_the_version_it_was_loaded_with():
    annotations = uploads_router._mapping_annotations({"status": "mapped", "fingerprint": "fp", "version": 3})

    assert annotations[storage.MAPPING_VERSION_METADATA_KEY] == "3"


# ---- Routes -----------------------------------------------------------------------------


def test_load_answers_200_with_a_result_per_file(monkeypatch):
    monkeypatch.setattr(
        upload_loading,
        "load_uploads",
        lambda paths: [
            {"blob_path": paths[0], "success": True},
            {"blob_path": paths[1], "success": False, "error": "not approved"},
        ],
    )

    response = client.post("/api/uploads/load", json={"blob_paths": ["uploads/a.txt", "uploads/b.txt"]})

    assert response.status_code == 200
    assert response.json()["loaded"] == 1
    assert response.json()["failed"] == 1


def test_loading_nothing_is_422():
    response = client.post("/api/uploads/load", json={"blob_paths": []})

    assert response.status_code == 422


def test_preview_maps_an_unexpected_failure_to_500(monkeypatch):
    def explode(paths):
        raise RuntimeError("boom")

    monkeypatch.setattr(upload_loading, "preview_loads", explode)

    response = client.post("/api/uploads/load/preview", json={"blob_paths": ["uploads/a.txt"]})

    assert response.status_code == 500
    assert "boom" in response.json()["detail"]
