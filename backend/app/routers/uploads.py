import asyncio
import datetime
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.services import storage
from app.services import generate_mapping
from app.services import mapping_view
from app.services import apply_contract as contract_application
from app.services.mapping_service import extract_header_signature, find_matching_mapping
from app.services.validation_service import process_and_validate

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class ConfirmRequest(BaseModel):
    # Only present if the user edited the proposed contract before approving.
    # When omitted, the pending contract is confirmed unchanged.
    contract: dict | None = None
    # The review screen edits rules, not raw contracts. Sending those instead
    # keeps the contract shape -- and its validation -- on the server.
    rules: list[dict] | None = None


def _preview(dataframe, limit: int = 3) -> list[dict]:
    """Return a small JSON-safe preview without exposing the full upload."""
    preview = dataframe.head(limit).copy()
    for column in preview.select_dtypes(include=["datetime", "datetimetz"]).columns:
        preview[column] = preview[column].dt.strftime("%Y-%m-%d")
    preview = preview.astype(object).where(preview.notna(), None)
    return preview.to_dict(orient="records")


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
async def upload_files(files: List[UploadFile] = File(...)):
    """
    Accept one or many files, upload them all, and propose a mapping contract
    for each.

    Returns HTTP 200 with a per-file result list even when some files fail, so a
    single bad file doesn't discard the successful ones. Check the "failed"
    count in the response rather than relying on the status code alone.

    Each successful upload gains a "mapping" key with one of three statuses:
      - "mapped"                a confirmed contract already existed for these
                                headers; nothing to approve
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
    res = await asyncio.to_thread(storage.upload_many, payload)

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

    return res


@router.get("/mappings")
async def list_mappings():
    """
    Every mapping the review screen can show, in one shape.

    That is the builtin FairPrice rule set plus each contract in the bucket --
    confirmed ones first, then proposals still awaiting approval.
    """

    def collect() -> list[dict]:
        packets = [mapping_view.builtin_packet()]

        for state in ("confirmed", "pending"):
            path_for = (
                storage.confirmed_mapping_path
                if state == "confirmed"
                else storage.pending_mapping_path
            )
            for fingerprint in storage.list_mapping_fingerprints(state):
                envelope = storage.download_json(path_for(fingerprint))
                if envelope:
                    packets.append(
                        mapping_view.envelope_to_packet(fingerprint, envelope, state)
                    )

        return packets

    try:
        return {"mappings": await asyncio.to_thread(collect)}
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Unable to read stored mappings: {exc}"
        )


@router.get("/mappings/{fingerprint}")
async def get_mapping(fingerprint: str):
    """
    Fetch a contract by fingerprint — the confirmed one if it exists, otherwise
    the pending proposal. Lets a review screen reload without re-uploading.
    """
    confirmed = await asyncio.to_thread(
        storage.download_json, storage.confirmed_mapping_path(fingerprint)
    )
    if confirmed:
        return {"state": "confirmed", **confirmed}

    pending = await asyncio.to_thread(
        storage.download_json, storage.pending_mapping_path(fingerprint)
    )
    if pending:
        return {"state": "pending", **pending}

    raise HTTPException(status_code=404, detail="No mapping found for that fingerprint.")


@router.post("/mappings/{fingerprint}/confirm")
async def confirm_mapping(fingerprint: str, body: ConfirmRequest):
    """
    Approve a pending contract and promote it to mappings/confirmed/.

    The contract is re-validated here rather than trusted as sent, because this
    is the last gate before it becomes the contract every future file with
    these headers gets run through.
    """
    envelope_before = await asyncio.to_thread(
        storage.download_json, storage.pending_mapping_path(fingerprint)
    )
    # A confirmed contract can be amended again, and by then its pending blob
    # has been cleaned up -- so fall back to the confirmed one.
    if not envelope_before:
        envelope_before = await asyncio.to_thread(
            storage.download_json, storage.confirmed_mapping_path(fingerprint)
        )
    if not envelope_before:
        raise HTTPException(
            status_code=404, detail="No mapping found for that fingerprint."
        )

    pending = envelope_before

    if body.rules is not None:
        proposed = mapping_view.rules_to_contract(body.rules)
    elif body.contract is not None:
        proposed = body.contract
    else:
        proposed = pending["contract"]

    contract = generate_mapping.validate_contract(
        proposed,
        pending["raw_columns"],
        pending.get("target_schema", generate_mapping.TARGET_SCHEMA),
    )

    if not contract["identity_mapping"] and not contract["melt_groups"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Contract is empty after validation — nothing to store.",
                "warnings": contract["warnings"],
            },
        )

    envelope = {
        **pending,
        "contract": contract,
        "edited_by_user": body.contract is not None or body.rules is not None,
        "confirmed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    stored_at = await asyncio.to_thread(
        storage.upload_json, storage.confirmed_mapping_path(fingerprint), envelope
    )

    # Best effort — a leftover pending blob is harmless, and the confirmed
    # contract now takes precedence on lookup either way.
    try:
        await asyncio.to_thread(
            storage.delete_blob, storage.pending_mapping_path(fingerprint)
        )
    except Exception:
        pass

    return {
        "success": True,
        "fingerprint": fingerprint,
        "stored_at": stored_at,
        "contract": contract,
        "warnings": contract["warnings"],
    }


@router.delete("/mappings/{fingerprint}/pending")
async def discard_pending_mapping(fingerprint: str):
    """Throw away a proposal the user rejected, so the next upload regenerates it."""
    deleted = await asyncio.to_thread(
        storage.delete_blob, storage.pending_mapping_path(fingerprint)
    )
    if not deleted:
        raise HTTPException(
            status_code=404, detail="No pending mapping for that fingerprint."
        )
    return {"success": True, "fingerprint": fingerprint}
