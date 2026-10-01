import asyncio
from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query

from app.services import storage
from app.services import generate_mapping
from app.services import apply_contract as contract_application
from app.services import sellout_ingestion, sellout_service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def _mapping_annotations(mapping: dict | None) -> dict[str, str]:
    """
    The bits of a mapping outcome worth writing back onto the uploaded blob.

    Only what the history listing shows, and only when it has a value — GCS
    custom metadata is a flat string map, so a None would be stored as the
    string "None" and read back as one.
    """
    if not mapping:
        return {}

    status = mapping.get("status")

    # Only record a fingerprint that addresses a mapping someone can open. A
    # partial match stores no contract -- its fingerprint is the new layout's,
    # which nothing is filed under -- so recording it would give the history a
    # "View mapping" link that 404s.
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


def _list_upload_history(limit: int) -> list[dict]:
    """Return uploads whose referenced mapping still exists.

    Older blobs can still contain metadata from the removed built-in mapper,
    such as ``fairprice_wide_v1``. That identifier has no corresponding GCS
    contract, so the stale history entry is omitted rather than presented as
    an addressable mapping or as a new review state.
    """
    uploads = storage.list_uploads(limit)
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
    """
    Accept one or many files, upload them all, and propose a mapping contract
    for each.

    Files that duplicate a previous upload — by content hash, or failing that
    by original filename — are skipped (with a "duplicate" result) unless
    `force` replaces the previous upload, or `keep_duplicate` keeps both. A
    skipped duplicate is not uploaded, so it never reaches mapping resolution
    below.

    Returns HTTP 200 with a per-file result list even when some files fail, so a
    single bad file doesn't discard the successful ones. Check the "failed"
    count in the response rather than relying on the status code alone.

    Each successful upload gains a "mapping" key with one of four statuses:
      - "mapped"                a confirmed contract already existed for these
                                headers; nothing to approve
      - "partial_match"         the layout nearly matches a confirmed mapping.
                                Nothing was applied — a person decides whether
                                it is the same layout with a column added
      - "pending_confirmation"  a fresh contract was generated and parked in
                                mappings/pending/ — POST to the confirm
                                endpoint with the fingerprint to keep it
      - "mapping_failed"        the file uploaded fine but the contract could
                                not be produced
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were sent.")

    # Read every stream exactly once. Anything downstream that needs the file
    # contents gets these bytes — the UploadFile objects are drained after this.
    payload: list[tuple[str, bytes]] = [
        (f.filename or "unnamed", await f.read()) for f in files
    ]

    # storage.upload_many is blocking (network I/O), so keep it off the event loop.
    res = await asyncio.to_thread(
        storage.upload_many, payload, force=force, keep_duplicate=keep_duplicate
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
        except generate_mapping.UnreadableSourceFileError as e:
            return {"status": "mapping_failed", "reason": "unreadable_file", "error": str(e)}
        except generate_mapping.MappingConfigError as e:
            return {"status": "mapping_failed", "reason": "config", "error": str(e)}
        except generate_mapping.MappingGenerationError as e:
            return {"status": "mapping_failed", "reason": "bad_llm_output", "error": str(e)}
        except contract_application.ContractApplicationError as e:
            return {"status": "mapping_failed", "reason": "application", "error": str(e)}
        except sellout_service.SelloutLoadError as e:
            return {"status": "mapping_failed", "reason": "cloud_sql", "error": str(e)}
        except Exception as e:
            return {"status": "mapping_failed", "reason": "unexpected", "error": str(e)}

    # upload_many preserves input order, so results pair back to payload by index.
    # gather runs the per-file Claude calls concurrently instead of end to end.
    mappings = await asyncio.gather(
        *[resolve(entry, uploaded) for entry, uploaded in zip(payload, res["results"])]
    )

    for uploaded, mapping in zip(res["results"], mappings):
        if mapping is not None:
            uploaded["mapping"] = mapping

    # Record the outcome on the blob itself so the history listing can say what
    # each file was mapped through without re-reading and re-fingerprinting
    # every file in the bucket.
    await asyncio.gather(
        *[
            asyncio.to_thread(storage.annotate_upload, result["blob_path"], annotations)
            for result in res["results"]
            if result.get("success")
            and (annotations := _mapping_annotations(result.get("mapping")))
        ]
    )

    return res


@router.get("/history")
async def upload_history(limit: int = Query(default=50, ge=1, le=200)):
    """
    Recent uploads, newest first — filename, vendor, date, and the mapping the
    file was run through.

    Read straight from the bucket listing: the blobs are the record of what has
    been uploaded, so there is nothing else that could go stale against them.
    """
    try:
        return {"uploads": await asyncio.to_thread(_list_upload_history, limit)}
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Unable to read upload history: {exc}"
        )

