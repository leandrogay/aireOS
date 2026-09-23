"""
Everything to do with stored mapping contracts.

These endpoints used to live under /api/uploads because a mapping only ever
appeared as a side effect of uploading a file. They no longer do: the review
screen loads, edits, previews and approves mappings on their own, long after
the upload that proposed them. Uploading is one thing, curating the mappings
uploads are run through is another, and they now have a router each.
"""

import asyncio
import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import storage
from app.services import generate_mapping
from app.services import mapping_view
from app.services import apply_contract as contract_application

router = APIRouter(prefix="/api/mappings", tags=["mappings"])


class ConfirmRequest(BaseModel):
    # Only present if the user edited the proposed contract before approving.
    # When omitted, the pending contract is confirmed unchanged.
    contract: dict | None = None
    # The review screen edits rules, not raw contracts. Sending those instead
    # keeps the contract shape -- and its validation -- on the server.
    rules: list[dict] | None = None
    # What this mapping is called and whose files it reads. Required on a first
    # approval so the mapping can be recognised later by something other than a
    # 16-character hash; optional afterwards, when amending leaves them as they
    # were.
    name: str | None = Field(default=None, max_length=120)
    vendor: str | None = Field(default=None, max_length=120)


class PreviewRequest(BaseModel):
    """Rules to preview. Omitted, the stored contract is previewed as-is."""

    rules: list[dict] | None = None
    contract: dict | None = None
    limit: int = Field(default=5, ge=1, le=25)


def _load_envelope(fingerprint: str):
    """The confirmed envelope for a fingerprint if there is one, else pending."""
    confirmed = storage.download_json(storage.confirmed_mapping_path(fingerprint))
    if confirmed:
        return confirmed, "confirmed"

    pending = storage.download_json(storage.pending_mapping_path(fingerprint))
    if pending:
        return pending, "pending"

    return None, None


@router.get("")
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


@router.get("/{fingerprint}")
async def get_mapping(fingerprint: str):
    """
    Fetch one mapping by fingerprint — the confirmed one if it exists,
    otherwise the pending proposal. Returned in the same review shape the
    listing uses, so the review screen can load a single mapping directly
    instead of fetching every mapping to find one.
    """
    if fingerprint == mapping_view.BUILTIN_MAPPING_ID:
        return mapping_view.builtin_packet()

    envelope, state = await asyncio.to_thread(_load_envelope, fingerprint)
    if not envelope:
        raise HTTPException(
            status_code=404, detail="No mapping found for that fingerprint."
        )

    # The raw contract rides along only here, not in the listing: it is what is
    # actually stored, and a single-mapping view is where seeing it is worth
    # the bytes.
    return {
        **mapping_view.envelope_to_packet(fingerprint, envelope, state),
        "contract": envelope.get("contract") or {},
        "proposedAt": envelope.get("proposed_at"),
    }


@router.post("/{fingerprint}/preview")
async def preview_mapping(fingerprint: str, body: PreviewRequest):
    """
    Show what this mapping does to real rows.

    The example file the proposal was made from is re-read out of the bucket
    and run through the contract, so the reviewer sees output rows rather than
    a description of what the rules would do. Edited rules can be previewed
    before they are approved, which is the whole point -- otherwise the first
    time anyone sees the effect of a change is after it is stored.
    """
    envelope, _ = await asyncio.to_thread(_load_envelope, fingerprint)
    if not envelope:
        raise HTTPException(
            status_code=404, detail="No mapping found for that fingerprint."
        )

    example_file = envelope.get("example_file")
    if not example_file:
        raise HTTPException(
            status_code=409,
            detail="This mapping has no example file stored, so it cannot be previewed.",
        )

    if body.rules is not None:
        contract = mapping_view.rules_to_contract(body.rules)
    elif body.contract is not None:
        contract = body.contract
    else:
        contract = envelope.get("contract") or {}

    def build() -> dict:
        blob_path = storage.blob_path_from_uri(example_file)
        data = storage.download_bytes(blob_path)
        if data is None:
            raise FileNotFoundError(example_file)

        filename = envelope.get("source_filename") or blob_path.rsplit("/", 1)[-1]
        dataframe = contract_application.read_source_dataframe(filename, data)
        mapped = contract_application.apply_contract(dataframe, contract)

        target_columns = [
            column
            for column in envelope.get("target_schema", generate_mapping.TARGET_SCHEMA)
            if column in mapped
        ]
        return {
            "columns": target_columns,
            "rows_total": len(mapped),
            "preview": contract_application.preview_rows(
                mapped[target_columns], body.limit
            ),
        }

    try:
        return await asyncio.to_thread(build)
    except FileNotFoundError:
        raise HTTPException(
            status_code=410,
            detail="The example file for this mapping is no longer in the bucket.",
        )
    except contract_application.ContractApplicationError as exc:
        # A contract that cannot be applied is the reviewer's answer, not a
        # server fault -- they asked what these rules do, and this is what they
        # do.
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Unable to build preview: {exc}")


@router.post("/{fingerprint}/confirm")
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

    # An amendment inherits the name and vendor it was approved under; only a
    # first approval has to supply them.
    name = (body.name or pending.get("name") or "").strip()
    vendor = (body.vendor or pending.get("vendor") or "").strip()
    if not name or not vendor:
        raise HTTPException(
            status_code=422,
            detail="A mapping needs a name and a vendor before it can be saved for reuse.",
        )

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
        "name": name,
        "vendor": vendor,
        "edited_by_user": body.contract is not None or body.rules is not None,
        "confirmed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    # mappings/pending/<fp>.json -> mappings/confirmed/<fp>.json
    move = await asyncio.to_thread(
        storage.move_pending_mapping_to_confirmed, fingerprint, envelope
    )

    # Every file already uploaded against this fingerprint was recorded as
    # awaiting review. It isn't any more, so the upload history is corrected
    # here rather than left to say something that stopped being true.
    uploads = await asyncio.to_thread(
        storage.update_uploads_for_mapping,
        fingerprint,
        {
            storage.MAPPING_STATUS_METADATA_KEY: "mapped",
            storage.MAPPING_NAME_METADATA_KEY: name,
            storage.VENDOR_METADATA_KEY: vendor,
        },
    )

    # =========================================================================
    # TRIGGER THE DATA TRANSFORMATION HERE.
    #
    # This is the moment for it: the contract is confirmed, and every file in
    # uploads["matched"] was uploaded against it while it was still a proposal,
    # so they have been waiting for exactly this.
    #
    # To hand: storage.download_bytes(blob_path) for the file,
    # contract_application.read_source_dataframe() to parse it,
    # contract_application.apply_contract(df, contract) to map it, and
    # validation_service.process_and_validate() to reject bad rows.
    #
    # Worth deciding before you write it: this runs inside a request, so a
    # large file probably belongs on a queue rather than making the browser
    # wait; and a file can reach here twice if the mapping is amended and
    # re-confirmed, which would double-count its sales.
    #
    # The other moment is in routers/uploads.py, where a file arrives and
    # matches a contract that is already confirmed.
    # =========================================================================

    return {
        "success": True,
        "fingerprint": fingerprint,
        "name": name,
        "vendor": vendor,
        "stored_at": move["stored_at"],
        "moved_from": move["pending_path"],
        "moved_to": move["confirmed_path"],
        "pending_removed": move["removed_pending"],
        "uploads_updated": len(uploads["updated"]),
        "contract": contract,
        "warnings": contract["warnings"],
    }


@router.delete("/{fingerprint}/pending")
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
