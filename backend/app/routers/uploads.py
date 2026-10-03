import asyncio
import datetime
from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query

from app.services import storage
from app.services import generate_mapping
from app.services import apply_contract as contract_application
from app.services import sellout_ingestion, sellout_service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def _mapping_annotations(mapping: dict | None) -> dict[str, str]:
    """Return the mapping outcome fields stored on an uploaded GCS blob."""
    if not mapping:
        return {}

    status = mapping.get("status")
    addressable = status in ("mapped", "pending_confirmation")
    fields = {
        storage.MAPPING_STATUS_METADATA_KEY: status,
        storage.MAPPING_FINGERPRINT_METADATA_KEY: (
            mapping.get("fingerprint") if addressable else None
        ),
        storage.MAPPING_NAME_METADATA_KEY: mapping.get("name"),
        storage.VENDOR_METADATA_KEY: mapping.get("vendor"),
    }
    return {key: str(value) for key, value in fields.items() if value}


def resolve_and_apply_mapping(
    filename: str,
    data: bytes,
    uploaded_to: str | None = None,
    replace_source: bool = False,
) -> dict:
    """Resolve one GCS mapping, then validate and store confirmed output."""
    resolved = generate_mapping.resolve_mapping(filename, data, uploaded_to)
    if resolved.get("status") != "mapped":
        return resolved

    resolved["processing"] = sellout_ingestion.process_confirmed_upload(
        filename,
        data,
        resolved.get("contract") or {},
        replace_source=replace_source,
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

    return [
        {
            **upload,
            "mapping_available": bool(upload.get("mapping_fingerprint")),
        }
        for upload in uploads
        if not upload.get("mapping_fingerprint")
        or upload["mapping_fingerprint"] in available_fingerprints
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
                "error": str(exc),
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
