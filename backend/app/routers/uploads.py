import asyncio
import datetime
from typing import List

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query

from app import config
from app.auth import require_user
from app.schemas.uploads import DeleteUploadRequest, LoadRequest, RollbackUploadRequest
from app.services import storage
from app.services import generate_mapping
from app.services import apply_contract as contract_application
from app.services import ingestion_service, sellout_ingestion, sellout_service
from app.services import upload_check
from app.services import upload_loading

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

def _mapping_annotations(mapping: dict | None) -> dict[str, str]:
    """Return the mapping outcome fields stored on an uploaded GCS blob."""
    if not mapping:
        return {}

    status = mapping.get("status")
    addressable = status in ("mapped", "ready_to_load", "pending_confirmation")
    fields = {
        storage.MAPPING_STATUS_METADATA_KEY: status,
        storage.MAPPING_FINGERPRINT_METADATA_KEY: (
            mapping.get("fingerprint") if addressable else None
        ),
        storage.MAPPING_NAME_METADATA_KEY: mapping.get("name"),
        storage.VENDOR_METADATA_KEY: mapping.get("vendor"),
        # Which version's rows are in sell-out, so a later version can offer
        # this file a reload (upload_loading.mark_uploads_after_approval).
        storage.MAPPING_VERSION_METADATA_KEY: (
            mapping.get("version") if status == "mapped" else None
        ),
    }
    return {key: str(value) for key, value in fields.items() if value}


def resolve_and_apply_mapping(
    filename: str,
    data: bytes,
    uploaded_to: str | None = None,
    replace_source: bool = False,
    content_hash: str | None = None,
    source_blob: str | None = None,
) -> dict:
    """
    Resolve one GCS mapping, then validate and store confirmed output -- or,
    with REQUIRE_LOAD_CONFIRMATION on, leave the file ready to load, for a
    person to load after a dry run (upload_loading).
    """
    resolved = generate_mapping.resolve_mapping(filename, data, uploaded_to)
    if resolved.get("status") != "mapped":
        return resolved

    if config.load_confirmation_required():
        resolved["status"] = upload_loading.READY_TO_LOAD
        return resolved

    resolved["processing"] = sellout_ingestion.process_confirmed_upload(
        filename,
        data,
        resolved.get("contract") or {},
        replace_source=replace_source,
        source_blob=source_blob or (
            storage.blob_path_from_uri(uploaded_to) if uploaded_to else None
        ),
        content_hash=content_hash,
        mapping_fingerprint=resolved.get("fingerprint"),
    )
    return resolved


def _list_upload_history(limit: int, months: int | None = None) -> list[dict]:
    """Return uploads whose referenced mapping still exists.

    Older blobs can still contain metadata from the removed built-in mapper,
    such as ``fairprice_wide_v1``. That identifier has no corresponding GCS
    contract, so the stale history entry is omitted rather than presented as
    an addressable mapping or as a new review state.

    ``months`` keeps only uploads from that many calendar months back, counted
    from now in UTC.
    """
    since = None
    if months is not None:
        since = storage.months_before(datetime.datetime.now(datetime.timezone.utc), months)

    uploads = storage.list_uploads(limit, since=since)
    available_fingerprints = {
        *storage.list_mapping_fingerprints("confirmed"),
        *storage.list_mapping_fingerprints("pending"),
    }

    visible = [
        {
            **upload,
            "mapping_available": bool(upload.get("mapping_fingerprint")),
        }
        for upload in uploads
        if not upload.get("mapping_fingerprint")
        or upload["mapping_fingerprint"] in available_fingerprints
    ]
    blob_paths = [
        upload["blob_path"]
        for upload in visible
        if upload.get("blob_path")
    ]
    states = (
        ingestion_service.upload_states(blob_paths)
        if sellout_service.cloud_sql_loading_enabled()
        else {}
    )
    return [
        {
            **upload,
            **states.get(upload.get("blob_path"), {}),
            "rollback_available": states.get(upload.get("blob_path"), {}).get("status")
            == "completed",
        }
        for upload in visible
    ]


@router.post("")
async def upload_files(
    files: List[UploadFile] = File(...),
    force: bool = Form(False),
    keep_duplicate: bool = Form(False),
):
    """Upload files and resolve each one through a GCS mapping contract."""
    if not files:
        raise HTTPException(status_code=400, detail="No files were sent.")

    payload: list[tuple[str, bytes]] = [
        (file.filename or "unnamed", await file.read()) for file in files
    ]

    res = await asyncio.to_thread(
        storage.upload_many,
        payload,
        force=force,
        keep_duplicate=keep_duplicate,
    )

    async def resolve(entry: tuple[str, bytes], uploaded: dict):
        if not uploaded.get("success"):
            return None
        filename, data = entry
        try:
            return await asyncio.to_thread(
                resolve_and_apply_mapping,
                filename,
                data,
                uploaded.get("destination"),
                force,
                uploaded.get("content_hash"),
                uploaded.get("blob_path"),
            )
        except generate_mapping.UnreadableSourceFileError as exc:
            return {
                "status": "mapping_failed",
                "reason": "unreadable_file",
                "error": str(exc),
            }
        except generate_mapping.MappingConfigError as exc:
            return {
                "status": "mapping_failed",
                "reason": "config",
                "error": str(exc),
            }
        except generate_mapping.MappingGenerationError as exc:
            return {
                "status": "mapping_failed",
                "reason": "bad_llm_output",
                "error": f"Unable to propose a mapping for {filename}: {exc}",
            }
        except contract_application.ContractApplicationError as exc:
            return {
                "status": "mapping_failed",
                "reason": "application",
                "error": str(exc),
            }
        except sellout_service.SelloutLoadError as exc:
            return {
                "status": "mapping_failed",
                "reason": "cloud_sql",
                "error": str(exc),
            }
        except Exception as exc:
            return {
                "status": "mapping_failed",
                "reason": "unexpected",
                "error": str(exc),
            }

    mappings = await asyncio.gather(
        *[
            resolve(entry, uploaded)
            for entry, uploaded in zip(payload, res["results"])
        ]
    )

    for uploaded, mapping in zip(res["results"], mappings):
        if mapping is not None:
            uploaded["mapping"] = mapping

    await asyncio.gather(
        *[
            asyncio.to_thread(
                storage.annotate_upload,
                result["blob_path"],
                annotations,
            )
            for result in res["results"]
            if result.get("success")
            and (annotations := _mapping_annotations(result.get("mapping")))
        ]
    )

    return res


@router.post("/check")
async def check_files(files: List[UploadFile] = File(...)):
    """
    What would happen to each file if it were uploaded: whether it can be,
    the mapping it would get, and the earlier upload it duplicates. Read-only
    -- nothing is stored and no mapping is generated (see upload_check).
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were sent.")

    payload: list[tuple[str, bytes]] = [
        (file.filename or "unnamed", await file.read()) for file in files
    ]

    try:
        return {"results": await asyncio.to_thread(upload_check.check_files, payload)}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to check files against earlier uploads: {exc}",
        )


@router.get("/history")
async def upload_history(
    limit: int = Query(default=50, ge=1, le=200),
    months: int | None = Query(default=None, ge=1, le=24),
):
    """Return recent GCS uploads with only live mapping references."""
    try:
        return {"uploads": await asyncio.to_thread(_list_upload_history, limit, months)}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to read upload history: {exc}",
        )


@router.post("/rollback")
def rollback_upload(
    payload: RollbackUploadRequest,
    user: dict = Depends(require_user),
):
    """Restore the sell-out state from before one transformed upload."""
    try:
        return ingestion_service.rollback_upload(
            payload.blob_path,
            rolled_back_by=str(user.get("email") or user.get("sub") or "unknown"),
            reason=payload.reason,
        )
    except ingestion_service.IngestionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (
        ingestion_service.IngestionAlreadyRolledBackError,
        ingestion_service.IngestionInProgressError,
    ) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ingestion_service.IngestionRollbackError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/source")
def delete_upload_source(payload: DeleteUploadRequest):
    """Remove one raw GCS upload after any active SQL load is rolled back."""
    try:
        return ingestion_service.delete_upload_source(payload.blob_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ingestion_service.UploadSourceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (
        ingestion_service.IngestionInProgressError,
        ingestion_service.UploadSourceStillLoadedError,
    ) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (storage.GCSUploadError, storage.GCSPermissionError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ---- Loading into sell-out -------------------------------------------------
#
# Separate from uploading and approving a mapping. The screen previews, a
# person confirms, then the versioned load can be rolled back if necessary.
# Both endpoints answer 200 with one result per file, like upload_files.

@router.post("/load/preview")
async def preview_load(body: LoadRequest):
    """Dry run: what loading each file would store, replace and overwrite."""
    try:
        return {"files": await asyncio.to_thread(upload_loading.preview_loads, body.blob_paths)}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to preview the load: {type(exc).__name__}: {exc}",
        )


@router.post("/load")
async def load_files(body: LoadRequest):
    """Load each file into sell-out with the current version of its mapping."""
    try:
        results = await asyncio.to_thread(upload_loading.load_uploads, body.blob_paths)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load files: {type(exc).__name__}: {exc}",
        )

    loaded = sum(1 for result in results if result["success"])
    return {
        "success": loaded == len(results),
        "loaded": loaded,
        "failed": len(results) - loaded,
        "results": results,
    }
