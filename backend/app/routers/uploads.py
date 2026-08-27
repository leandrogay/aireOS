import asyncio
import datetime
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.services import storage
from app.services import generate_mapping

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class ConfirmRequest(BaseModel):
    # Only present if the user edited the proposed contract before approving.
    # When omitted, the pending contract is confirmed unchanged.
    contract: dict | None = None


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
                generate_mapping.resolve_mapping,
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
    pending = await asyncio.to_thread(
        storage.download_json, storage.pending_mapping_path(fingerprint)
    )
    if not pending:
        raise HTTPException(
            status_code=404, detail="No pending mapping for that fingerprint."
        )

    proposed = body.contract if body.contract is not None else pending["contract"]

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
        "edited_by_user": body.contract is not None,
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
