import asyncio
from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query

from app.services import storage
from app.services import generate_mapping
from app.services import mapping_view
from app.services import apply_contract as contract_application
from app.services.mapping_service import extract_header_signature, find_matching_mapping
from app.services.validation_service import process_and_validate

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

def _preview(dataframe, limit: int = 3) -> list[dict]:
    """Small JSON-safe preview of mapped output. See apply_contract."""
    return contract_application.preview_rows(dataframe, limit)


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
            mapping.get("fingerprint") or mapping.get("mapping_id")
            if addressable
            else None
        ),
        storage.MAPPING_NAME_METADATA_KEY: mapping.get("name"),
        storage.VENDOR_METADATA_KEY: mapping.get("vendor"),
    }
    return {key: str(value) for key, value in fields.items() if value}


def resolve_and_apply_mapping(
    filename: str, data: bytes, uploaded_to: str | None = None
) -> dict:
    """Resolve one mapping and immediately apply it when it is recognised."""
    dataframe = contract_application.read_source_dataframe(filename, data)
    headers = extract_header_signature(dataframe)

    # AO1-2's approved FairPrice mapping is built into the application. It is
    # checked before AO1-3 proposal generation so recognised files never call AI.
    builtin = find_matching_mapping(headers)
    if builtin:
        validated = process_and_validate(dataframe, builtin, filename)
        return {
            "status": "mapped",
            "mapping_id": builtin["mapping_id"],
            "name": mapping_view.BUILTIN_MAPPING_NAME,
            "vendor": mapping_view.BUILTIN_MAPPING_VENDOR,
            "source": "builtin",
            "processing": {
                "rows_total": validated["total_rows"],
                "rows_mapped": validated["rows_ingested"],
                "rows_rejected": validated["total_rejected"],
                "rejection_summary": validated["rejection_summary"],
                "columns": list(validated["valid_df"].columns),
                "preview": _preview(validated["valid_df"]),
            },
        }

    resolved = generate_mapping.resolve_mapping(filename, data, uploaded_to)
    if resolved.get("status") != "mapped":
        return resolved

    normalized = contract_application.apply_contract(
        dataframe, resolved.get("contract") or {}
    )
    if "source_file" in generate_mapping.TARGET_SCHEMA:
        normalized["source_file"] = filename

    target_columns = [
        column for column in generate_mapping.TARGET_SCHEMA if column in normalized
    ]
    normalized = normalized[target_columns]
    resolved["processing"] = {
        "rows_total": len(normalized),
        "rows_mapped": len(normalized),
        "rows_rejected": 0,
        "rejection_summary": "",
        "columns": target_columns,
        "preview": _preview(normalized),
    }
    return resolved


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
            )
        except generate_mapping.UnreadableSourceFileError as e:
            return {"status": "mapping_failed", "reason": "unreadable_file", "error": str(e)}
        except generate_mapping.MappingConfigError as e:
            return {"status": "mapping_failed", "reason": "config", "error": str(e)}
        except generate_mapping.MappingGenerationError as e:
            return {"status": "mapping_failed", "reason": "bad_llm_output", "error": str(e)}
        except contract_application.ContractApplicationError as e:
            return {"status": "mapping_failed", "reason": "application", "error": str(e)}
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

    # =========================================================================
    # TRIGGER THE DATA TRANSFORMATION HERE, for the files in res["results"]
    # whose mapping came back with status "mapped".
    #
    # Those matched a contract that is already confirmed, so nothing is waiting
    # on a person and they can be loaded straight away. Files whose mapping is
    # still a proposal are deliberately not ready here -- they get picked up
    # when someone approves it, in routers/mappings.py, which is the other
    # place this belongs.
    #
    # Each such result carries "blob_path" (where the file landed) and
    # mapping["fingerprint"] or mapping["mapping_id"] (the contract it matched).
    # resolve_and_apply_mapping above has already applied the contract to build
    # the preview, so mapping["processing"] shows the shape the rows come out
    # in -- but nothing is persisted anywhere yet.
    # =========================================================================

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
        return {"uploads": await asyncio.to_thread(storage.list_uploads, limit)}
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Unable to read upload history: {exc}"
        )

