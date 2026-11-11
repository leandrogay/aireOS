"""
Recent uploads, as the upload page lists them: one page at a time, searched
and sorted here rather than in the browser.

There is no upload table -- the bucket is the record (storage.list_uploads) --
so every request reads every upload from GCS, adds each file's load state
from Cloud SQL, and only then searches, sorts and slices. Sorting has to see
every row: the Status order depends on the load state (a rolled-back load),
which is only known after the Cloud SQL read, and a page sorted on its own
would put the wrong rows on page 1.
"""

from app.services import ingestion_service, sellout_service, storage


# ============================================================
# QUERY VOCABULARY
# ============================================================

HISTORY_SORT_FIELDS = ("status", "uploaded_at")
SORT_DIRECTIONS = ("asc", "desc")

# The Status column's ascending order: what needs someone to act on it first
# (a failed nomenclature, a review, a load or reload waiting), then what is
# done. Keys are mapping_status values, plus `rolled_back` for an upload whose
# load was reversed; anything not listed sorts last.
STATUS_SORT_ORDER = (
    "mapping_failed",
    "pending_confirmation",
    "partial_match",
    "ready_to_load",
    "reload_available",
    "mapped",
    "rolled_back",
)

# The fields the search box looks in.
SEARCH_FIELDS = ("filename", "vendor", "mapping_name")


# ============================================================
# PUBLIC
# ============================================================

def list_history(
    *,
    limit: int,
    offset: int = 0,
    search: str = "",
    sort: str = "status",
    direction: str = "asc",
) -> dict:
    """
    One page of upload history, plus how many uploads match (`total`) and how
    many there are before the search (`unfiltered_total`), so the page can
    say "12 of 70 uploads".

    An `offset` past the end is moved back to the last page rather than
    returning an empty one, so a list that shrank under the reader (a delete,
    a narrower search) lands on its new last page; the offset actually used
    is returned.
    """
    if sort not in HISTORY_SORT_FIELDS:
        raise ValueError(f"sort must be one of {', '.join(HISTORY_SORT_FIELDS)}")
    if direction not in SORT_DIRECTIONS:
        raise ValueError(f"direction must be one of {', '.join(SORT_DIRECTIONS)}")

    uploads = _visible_uploads()
    matching = _sorted(_searched(uploads, search), sort, direction)
    offset = _clamped_offset(offset, limit, len(matching))

    return {
        "uploads": matching[offset:offset + limit],
        "total": len(matching),
        "unfiltered_total": len(uploads),
        "limit": limit,
        "offset": offset,
    }


# ============================================================
# ROWS
# ============================================================

def _visible_uploads() -> list[dict]:
    """
    Uploads whose mapping still exists, each with its load state.

    An upload whose mapping was discarded points at a fingerprint with no GCS
    contract, so it is left out rather than presented as an addressable
    mapping or as a new review state.
    """
    uploads = storage.list_uploads()
    available_fingerprints = {
        *storage.list_mapping_fingerprints("confirmed"),
        *storage.list_mapping_fingerprints("pending"),
    }

    visible = [
        {**upload, "mapping_available": bool(upload.get("mapping_fingerprint"))}
        for upload in uploads
        if not upload.get("mapping_fingerprint")
        or upload["mapping_fingerprint"] in available_fingerprints
    ]
    return _with_load_states(visible)


def _with_load_states(uploads: list[dict]) -> list[dict]:
    """Each upload with its newest ingestion run's fields, when Cloud SQL loading is on."""
    blob_paths = [upload["blob_path"] for upload in uploads if upload.get("blob_path")]
    states = (
        ingestion_service.upload_states(blob_paths)
        if sellout_service.cloud_sql_loading_enabled()
        else {}
    )
    rows = []
    for upload in uploads:
        state = states.get(upload.get("blob_path"), {})
        rows.append({
            **upload,
            **state,
            "rollback_available": state.get("status") == "completed",
        })
    return rows


# ============================================================
# SEARCH, SORT, PAGE
# ============================================================

def _searched(uploads: list[dict], search: str) -> list[dict]:
    """Uploads whose file name, vendor or mapping name contains `search`, ignoring case."""
    needle = search.strip().lower()
    if not needle:
        return uploads
    return [
        upload for upload in uploads
        if any(needle in str(upload.get(field) or "").lower() for field in SEARCH_FIELDS)
    ]


def _status_rank(upload: dict) -> int:
    key = "rolled_back" if upload.get("status") == "rolled_back" else upload.get("mapping_status")
    if key in STATUS_SORT_ORDER:
        return STATUS_SORT_ORDER.index(key)
    return len(STATUS_SORT_ORDER)


def _sorted(uploads: list[dict], sort: str, direction: str) -> list[dict]:
    """
    Uploads in the order a sortable column asks for. Uploads with the same
    status stay newest first whichever way Status runs. `uploaded_at` is an
    ISO UTC string, so comparing the strings orders them in time; a missing
    one sorts as the oldest.
    """
    descending = direction == "desc"
    newest_first = sorted(uploads, key=lambda upload: upload.get("uploaded_at") or "", reverse=True)
    if sort == "uploaded_at":
        return newest_first if descending else newest_first[::-1]
    # sorted() is stable, so the newest-first order survives within each status.
    return sorted(newest_first, key=_status_rank, reverse=descending)


def _clamped_offset(offset: int, limit: int, total: int) -> int:
    """`offset`, or the start of the last page when it is past the end."""
    if offset < total:
        return offset
    last_page = max(0, (total - 1) // limit)
    return last_page * limit
