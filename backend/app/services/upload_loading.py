"""
Loading uploaded files into sell-out, as its own step after approval.

Approving a mapping saves instructions; it can be amended or replaced at any
time. Loading writes rows into Cloud SQL `sellout` only after a person reviews
a dry run. Each completed load is versioned by its unique GCS blob path so it
can be reloaded safely or rolled back later.

Each upload's state lives in its GCS metadata (storage.MAPPING_STATUS_METADATA_KEY):

  pending_confirmation  its mapping is still a proposal
  ready_to_load         its mapping is approved; nothing is loaded yet
  mapped                loaded, with the version in MAPPING_VERSION_METADATA_KEY
  reload_available      loaded, but with an older version of the mapping

`mapped` keeps its old name because every upload stamped before this step
existed was loaded when it was stamped so, and still reads correctly.
"""

from app.services import sellout_ingestion, storage

PENDING_REVIEW = "pending_confirmation"
READY_TO_LOAD = "ready_to_load"
LOADED = "mapped"
RELOAD_AVAILABLE = "reload_available"

# The only states a load is offered for. Anything else is either not
# approved yet or already loaded with the current version.
LOADABLE_STATUSES = (READY_TO_LOAD, RELOAD_AVAILABLE)


class UploadNotLoadableError(Exception):
    """This upload cannot be loaded as it stands; the message says why."""


# ============================================================
# After an approval
# ============================================================

def _status_after_approval(upload: dict, version: int) -> str:
    """
    What an upload becomes when its mapping is approved at `version`. A file
    already loaded with that version stays loaded; one loaded with an older
    version -- or before versions were recorded -- is offered a reload; any
    other file waits for its first load.
    """
    status = upload.get("mapping_status")
    if status == LOADED:
        return LOADED if upload.get("mapping_version") == str(version) else RELOAD_AVAILABLE
    if status == RELOAD_AVAILABLE:
        return RELOAD_AVAILABLE
    return READY_TO_LOAD


def mark_uploads_after_approval(fingerprint: str, *, name: str, vendor: str, version: int) -> dict:
    """
    Re-stamp every upload behind a mapping that has just been approved, and
    return the ones a person can now load: `waiting` (never loaded) and
    `outdated` (loaded with an older version). Nothing is loaded here.

    Best effort per file, like storage.annotate_upload: a history label that
    could not be rewritten is not a reason to fail the approval.
    """
    waiting: list[dict] = []
    outdated: list[dict] = []
    updated = 0

    for upload in storage.list_uploads_for_mapping(fingerprint):
        status = _status_after_approval(upload, version)
        annotated = storage.annotate_upload(
            upload["blob_path"],
            {
                storage.MAPPING_STATUS_METADATA_KEY: status,
                storage.MAPPING_NAME_METADATA_KEY: name,
                storage.VENDOR_METADATA_KEY: vendor,
            },
        )
        updated += int(annotated)

        row = {
            "blob_path": upload["blob_path"],
            "filename": upload["filename"],
            "uploaded_at": upload["uploaded_at"],
            "mapping_status": status,
            "loaded_version": upload.get("mapping_version"),
        }
        if status == READY_TO_LOAD:
            waiting.append(row)
        elif status == RELOAD_AVAILABLE:
            outdated.append(row)

    return {"waiting": waiting, "outdated": outdated, "updated": updated}


# ============================================================
# Discarding a proposal
# ============================================================

def uploads_waiting_on_proposal(fingerprint: str) -> list[dict]:
    """
    The uploads still waiting for this proposal to be reviewed. Nothing was
    loaded from them (loading needs an approved mapping), so they hold no
    sales data.
    """
    return [
        upload
        for upload in storage.list_uploads_for_mapping(fingerprint)
        if upload.get("mapping_status") == PENDING_REVIEW
    ]


def discard_proposal(fingerprint: str) -> dict:
    """
    Throw away a proposal together with the uploads waiting on it. A file whose
    proposal is gone has no review to come back to and nothing to load with, and
    re-uploading it would only be refused as a duplicate, so it goes too.

    The files go first: if something fails halfway, the proposal is still
    listed and the discard can be run again, instead of leaving files that
    point at a proposal that no longer exists.
    """
    removed = []
    for upload in uploads_waiting_on_proposal(fingerprint):
        if storage.delete_upload(upload["blob_path"]):
            removed.append({"blob_path": upload["blob_path"], "filename": upload["filename"]})

    proposal_deleted = storage.delete_blob(storage.pending_mapping_path(fingerprint))
    return {"proposal_deleted": proposal_deleted, "removed_uploads": removed}


class MappingHasUploadsError(ValueError):
    """A nomenclature still belongs to uploaded source files."""


def confirmed_mapping_deletion_status(fingerprint: str) -> dict | None:
    """Check the same upload condition enforced again during deletion."""
    if storage.download_json(storage.confirmed_mapping_path(fingerprint)) is None:
        return None
    upload_count = len(storage.list_uploads_for_mapping(fingerprint))
    return {"allowed": upload_count == 0, "upload_count": upload_count}


def delete_confirmed_mapping(fingerprint: str) -> bool:
    """Remove a confirmed contract only after all source uploads are gone.

    Archived versions go first so an interrupted delete leaves the live
    contract available and the action can be retried.
    """
    path = storage.confirmed_mapping_path(fingerprint)
    if storage.download_json(path) is None:
        return False
    if storage.list_uploads_for_mapping(fingerprint):
        raise MappingHasUploadsError(
            "Delete or roll back and delete the uploads using this nomenclature first."
        )
    for archived_path in storage.list_mapping_history_paths(fingerprint):
        storage.delete_blob(archived_path)
    storage.delete_blob(storage.pending_mapping_path(fingerprint))
    return storage.delete_blob(path)


# ============================================================
# Preview and load
# ============================================================

def _loadable(blob_path: str) -> tuple[dict, dict]:
    """
    The upload and the approved mapping envelope it would be loaded with, or
    UploadNotLoadableError saying why it cannot be. The mapping is read from
    mappings/confirmed/ every time, so a load always uses the current version.
    """
    upload = storage.get_upload(blob_path)
    if upload is None:
        raise UploadNotLoadableError("This file is no longer in the bucket.")

    status = upload.get("mapping_status")
    if status == LOADED:
        raise UploadNotLoadableError("This file is already loaded with the current version of its nomenclature.")
    if status == PENDING_REVIEW:
        raise UploadNotLoadableError("This file's nomenclature has not been approved yet.")
    if status not in LOADABLE_STATUSES:
        raise UploadNotLoadableError("This file has no approved nomenclature to load it with.")

    fingerprint = upload.get("mapping_fingerprint")
    envelope = storage.download_json(storage.confirmed_mapping_path(fingerprint)) if fingerprint else None
    if not envelope:
        raise UploadNotLoadableError("This file's nomenclature has not been approved yet.")
    return upload, envelope


def _file_row(upload: dict, envelope: dict | None = None) -> dict:
    """The part of every per-file result that says which file and mapping it is."""
    return {
        "blob_path": upload["blob_path"],
        "filename": upload.get("filename"),
        "uploaded_at": upload.get("uploaded_at"),
        "mapping_status": upload.get("mapping_status"),
        "reload": upload.get("mapping_status") == RELOAD_AVAILABLE,
        "mapping_name": (envelope or {}).get("name") or upload.get("mapping_name"),
        "mapping_version": (envelope or {}).get("version"),
        "loaded_version": upload.get("mapping_version"),
    }


def preview_loads(blob_paths: list[str]) -> list[dict]:
    """
    Dry run of load_uploads for each file, in the order given: the rows it
    would store, the periods and retailers they cover, and what in sell-out
    it would overwrite. A reload also previews replacement; a first load never
    replaces rows merely because another upload shares its filename.

    One file failing -- unreadable, not approved, the bucket or database not
    answering -- is reported on that file (`success: False`, `error`) rather
    than failing the others.
    """
    results = []
    for blob_path in dict.fromkeys(blob_paths):
        upload = {"blob_path": blob_path}
        try:
            upload, envelope = _loadable(blob_path)
            filename, data = _download(blob_path)
            reload = upload.get("mapping_status") == RELOAD_AVAILABLE
            preview = sellout_ingestion.preview_confirmed_upload(
                filename,
                data,
                envelope.get("contract") or {},
                replace_source=reload,
            )
            results.append({**_file_row(upload, envelope), "success": True, "preview": preview})
        except Exception as exc:
            results.append({**_file_row(upload), "success": False, "error": str(exc)})
    return results


def load_uploads(blob_paths: list[str]) -> list[dict]:
    """
    Load each file into sell-out with the current version of its approved
    mapping, each in its own transaction, then stamp it as loaded with that
    version. A reload replaces only stale rows from the previous completed run
    for the same GCS blob; a first load has no prior run to replace.

    Every file is checked again here rather than trusting the preview: its
    status may have changed since. One file failing is reported on that file
    and leaves the others to load; raising instead would hide which files the
    request had already loaded.
    """
    results = []
    for blob_path in dict.fromkeys(blob_paths):
        upload = {"blob_path": blob_path}
        try:
            upload, envelope = _loadable(blob_path)
            filename, data = _download(blob_path)
            reload = upload.get("mapping_status") == RELOAD_AVAILABLE
            processing = sellout_ingestion.process_confirmed_upload(
                filename,
                data,
                envelope.get("contract") or {},
                replace_source=reload,
                source_blob=blob_path,
                content_hash=upload.get("content_hash"),
                mapping_fingerprint=upload.get("mapping_fingerprint"),
            )
            # With Cloud SQL loading switched off nothing was written, so the
            # file keeps its loadable state rather than claiming a version.
            if processing.get("storage_status") != "disabled":
                storage.annotate_upload(
                    blob_path,
                    {
                        storage.MAPPING_STATUS_METADATA_KEY: LOADED,
                        storage.MAPPING_VERSION_METADATA_KEY: str(envelope.get("version") or 1),
                    },
                )
            results.append({**_file_row(upload, envelope), "success": True, "processing": processing})
        except Exception as exc:
            results.append({**_file_row(upload), "success": False, "error": str(exc)})
    return results


def _download(blob_path: str) -> tuple[str, bytes]:
    upload = storage.download_upload(blob_path)
    if upload is None:
        raise UploadNotLoadableError("This file is no longer in the bucket.")
    return upload
