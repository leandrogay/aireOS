"""
Recent uploads behind GET /api/uploads/history (services/upload_history.py).

The history is one page at a time, but the search, the sort and the page cut
all have to see every upload -- a page sorted on its own would
put the wrong uploads on page 1 -- so those are pinned here along with which
uploads are listed at all.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import ingestion_service, sellout_service, storage
from app.services import upload_history

client = TestClient(app)


def _upload(name, mapping_status="mapped", uploaded_at="2026-11-01T00:00:00+00:00", **fields):
    return {
        "filename": name,
        "blob_path": f"uploads/{name}",
        "mapping_status": mapping_status,
        "uploaded_at": uploaded_at,
        **fields,
    }


def _install(monkeypatch, uploads, fingerprints=(), states=None):
    """Fake bucket listing and stored contracts; Cloud SQL states only when `states` is given."""
    monkeypatch.setattr(storage, "list_uploads", lambda: list(uploads))
    monkeypatch.setattr(
        storage,
        "list_mapping_fingerprints",
        lambda state: list(fingerprints) if state == "confirmed" else [],
    )
    monkeypatch.setattr(sellout_service, "cloud_sql_loading_enabled", lambda: states is not None)
    monkeypatch.setattr(ingestion_service, "upload_states", lambda paths: states or {})


def _names(result):
    return [row["filename"] for row in result["uploads"]]


# ---- Which uploads are listed ----

def test_history_links_only_to_mappings_that_exist_in_gcs(monkeypatch):
    uploads = [
        _upload("legacy.txt", mapping_fingerprint="fairprice_wide_v1"),
        _upload("confirmed.txt", mapping_fingerprint="confirmed123"),
        _upload("unmapped.txt", mapping_fingerprint=None),
    ]
    _install(monkeypatch, uploads, fingerprints=["confirmed123"])

    result = upload_history.list_history(limit=25, sort="uploaded_at", direction="desc")

    assert sorted(_names(result)) == ["confirmed.txt", "unmapped.txt"]
    assert {row["filename"]: row["mapping_available"] for row in result["uploads"]} == {
        "confirmed.txt": True,
        "unmapped.txt": False,
    }


def test_completed_load_offers_rollback_and_rolled_back_does_not(monkeypatch):
    uploads = [_upload("done.txt"), _upload("undone.txt")]
    states = {
        "uploads/done.txt": {"status": "completed"},
        "uploads/undone.txt": {"status": "rolled_back"},
    }
    _install(monkeypatch, uploads, states=states)

    result = upload_history.list_history(limit=25)

    assert {row["filename"]: row["rollback_available"] for row in result["uploads"]} == {
        "done.txt": True,
        "undone.txt": False,
    }


# ---- Sort ----

STATUS_MIX = [
    _upload("loaded", "mapped", "2026-11-01T00:00:00+00:00"),
    _upload("rolled-back", "mapped", "2026-11-02T00:00:00+00:00"),
    _upload("unknown", "something_new", "2026-11-03T00:00:00+00:00"),
    _upload("waiting", "ready_to_load", "2026-11-04T00:00:00+00:00"),
    _upload("review", "pending_confirmation", "2026-11-05T00:00:00+00:00"),
    _upload("failed", "mapping_failed", "2026-11-06T00:00:00+00:00"),
    _upload("reload", "reload_available", "2026-11-07T00:00:00+00:00"),
]
STATUS_MIX_STATES = {"uploads/rolled-back": {"status": "rolled_back"}}


def test_status_ascending_puts_what_needs_acting_on_first_and_unknown_last(monkeypatch):
    _install(monkeypatch, STATUS_MIX, states=STATUS_MIX_STATES)

    result = upload_history.list_history(limit=25, sort="status", direction="asc")

    assert _names(result) == [
        "failed", "review", "waiting", "reload", "loaded", "rolled-back", "unknown",
    ]


def test_status_descending_reverses_the_status_order(monkeypatch):
    _install(monkeypatch, STATUS_MIX, states=STATUS_MIX_STATES)

    result = upload_history.list_history(limit=25, sort="status", direction="desc")

    assert _names(result) == [
        "unknown", "rolled-back", "loaded", "reload", "waiting", "review", "failed",
    ]


@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_uploads_with_the_same_status_are_newest_first_either_way(monkeypatch, direction):
    uploads = [
        _upload("older", "mapped", "2026-11-01T00:00:00+00:00"),
        _upload("newer", "mapped", "2026-11-09T00:00:00+00:00"),
    ]
    _install(monkeypatch, uploads)

    result = upload_history.list_history(limit=25, sort="status", direction=direction)

    assert _names(result) == ["newer", "older"]


def test_uploaded_at_sorts_by_time_with_a_missing_time_as_the_oldest(monkeypatch):
    uploads = [
        _upload("middle", uploaded_at="2026-11-05T00:00:00+00:00"),
        _upload("none", uploaded_at=None),
        _upload("latest", uploaded_at="2026-11-09T00:00:00+00:00"),
    ]
    _install(monkeypatch, uploads)

    newest = upload_history.list_history(limit=25, sort="uploaded_at", direction="desc")
    oldest = upload_history.list_history(limit=25, sort="uploaded_at", direction="asc")

    assert _names(newest) == ["latest", "middle", "none"]
    assert _names(oldest) == ["none", "middle", "latest"]


def test_sort_is_applied_across_pages_not_within_one(monkeypatch):
    # Newest first, the failed file would be on page 2; Status puts it first.
    uploads = [
        _upload("new-loaded", "mapped", "2026-11-09T00:00:00+00:00"),
        _upload("old-failed", "mapping_failed", "2026-11-01T00:00:00+00:00"),
    ]
    _install(monkeypatch, uploads)

    result = upload_history.list_history(limit=1, sort="status", direction="asc")

    assert _names(result) == ["old-failed"]


# ---- Search ----

def test_search_matches_file_vendor_or_mapping_name_ignoring_case(monkeypatch):
    uploads = [
        _upload("week01.txt", vendor="FairPrice"),
        _upload("other.txt", mapping_name="fairprice weekly"),
        _upload("sheng.txt", vendor="Sheng_Shiong"),
    ]
    _install(monkeypatch, uploads)

    result = upload_history.list_history(limit=25, search="  FAIRPRICE ")

    assert sorted(_names(result)) == ["other.txt", "week01.txt"]
    assert result["total"] == 2
    assert result["unfiltered_total"] == 3


# ---- Paging ----

def test_page_returns_its_slice_and_the_counts(monkeypatch):
    uploads = [_upload(f"f{day}", uploaded_at=f"2026-11-0{day}T00:00:00+00:00") for day in range(1, 6)]
    _install(monkeypatch, uploads)

    result = upload_history.list_history(limit=2, offset=2, sort="uploaded_at", direction="desc")

    assert _names(result) == ["f3", "f2"]
    assert (result["total"], result["limit"], result["offset"]) == (5, 2, 2)


def test_offset_past_the_end_moves_back_to_the_last_page(monkeypatch):
    uploads = [_upload(f"f{day}", uploaded_at=f"2026-11-0{day}T00:00:00+00:00") for day in range(1, 6)]
    _install(monkeypatch, uploads)

    result = upload_history.list_history(limit=2, offset=10, sort="uploaded_at", direction="desc")

    assert result["offset"] == 4
    assert _names(result) == ["f1"]


def test_empty_history_is_an_empty_first_page(monkeypatch):
    _install(monkeypatch, [])

    result = upload_history.list_history(limit=25, offset=50)

    assert result == {"uploads": [], "total": 0, "unfiltered_total": 0, "limit": 25, "offset": 0}


# ---- Validation ----

def _no_listing_allowed(*args, **kwargs):
    raise AssertionError("an invalid query must not read the bucket")


@pytest.mark.parametrize("query", [{"sort": "filename"}, {"direction": "up"}])
def test_invalid_sort_or_direction_raises_without_listing(monkeypatch, query):
    monkeypatch.setattr(storage, "list_uploads", _no_listing_allowed)

    with pytest.raises(ValueError):
        upload_history.list_history(limit=25, **query)


# ---- GET /api/uploads/history ----

def test_route_passes_the_query_to_the_service(monkeypatch):
    calls = []

    def _list_history(**kwargs):
        calls.append(kwargs)
        return {"uploads": [], "total": 0, "unfiltered_total": 0, "limit": 10, "offset": 20}

    monkeypatch.setattr(upload_history, "list_history", _list_history)

    response = client.get(
        "/api/uploads/history",
        params={"limit": 10, "offset": 20, "search": "fp", "sort": "uploaded_at", "direction": "desc"},
    )

    assert response.status_code == 200
    assert response.json()["offset"] == 20
    assert calls == [{
        "limit": 10, "offset": 20, "search": "fp", "sort": "uploaded_at", "direction": "desc",
    }]


def test_route_maps_a_bad_sort_to_400(monkeypatch):
    def _list_history(**kwargs):
        raise ValueError("sort must be one of status, uploaded_at")

    monkeypatch.setattr(upload_history, "list_history", _list_history)

    response = client.get("/api/uploads/history", params={"sort": "filename"})

    assert response.status_code == 400
    assert "sort must be one of" in response.json()["detail"]


def test_route_rejects_a_limit_over_100_with_422(monkeypatch):
    monkeypatch.setattr(upload_history, "list_history", _no_listing_allowed)

    response = client.get("/api/uploads/history", params={"limit": 101})

    assert response.status_code == 422


def test_route_maps_a_bucket_failure_to_503(monkeypatch):
    def _list_history(**kwargs):
        raise storage.GCSUploadError("listing failed")

    monkeypatch.setattr(upload_history, "list_history", _list_history)

    response = client.get("/api/uploads/history")

    assert response.status_code == 503
