"""
Everything to do with stored mapping contracts.

These endpoints used to live under /api/uploads because a mapping only ever
appeared as a side effect of uploading a file. They no longer do: the review
screen loads, edits, previews and approves mappings on their own, long after
the upload that proposed them. Uploading is one thing, curating the mappings
uploads are run through is another, and they now have a router each.

A contract is instructions for the transformation. Version 2 contracts are
checked here (statically, against the example file and the SKU master) but
not run: the transformation reads them once it supports that format. Version 1
contracts -- the FairPrice one -- still run through today's transformation.
"""

import asyncio
import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import storage
from app.services import generate_mapping
from app.services import mapping_view
from app.services import apply_contract as contract_application
from app.services import layout_detection, mapping_checks, mapping_contract
from app.services import sellout_ingestion

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


def _proposed_contract(envelope: dict, rules: list[dict] | None, contract: dict | None) -> dict:
    """
    The contract a request asks for: rebuilt from the review screen's rules,
    sent whole, or the stored one. Rules carry fields, not the contract-wide
    instructions, so those are kept from the stored contract: where the data
    sits, whether rows roll up, and what kind of data it is (decision D8).
    """
    stored = mapping_contract.upgrade(envelope.get("contract") or {})
    if rules is not None:
        proposed = mapping_view.rules_to_contract(rules)
        for key in ("layout", "aggregate", "data_source"):
            proposed[key] = stored.get(key)
        return proposed
    if contract is not None:
        return contract
    return envelope.get("contract") or {}


def _example_table(envelope: dict):
    """The example file's data table and layout, or None when it is not stored."""
    example_file = envelope.get("example_file")
    if not example_file:
        return None
    blob_path = storage.blob_path_from_uri(example_file)
    data = storage.download_bytes(blob_path)
    if data is None:
        raise FileNotFoundError(example_file)
    filename = envelope.get("source_filename") or blob_path.rsplit("/", 1)[-1]
    try:
        frame, layout = layout_detection.read_table(filename, data)
    except layout_detection.LayoutError as exc:
        raise contract_application.ContractApplicationError(str(exc)) from exc
    return filename, data, frame, layout


def _ingest_waiting_uploads(blob_paths: list[str], contract: dict) -> list[dict]:
    """
    Process files that were waiting for this mapping to be approved -- when
    today's transformation can run it. A version 2 contract is left for the
    transformation, and its uploads stay stored and mapped.
    """
    if mapping_contract.is_v2(contract):
        return []

    results = []
    for blob_path in blob_paths:
        try:
            upload = storage.download_upload(blob_path)
            if upload is None:
                raise FileNotFoundError(blob_path)
            filename, data = upload
            processing = sellout_ingestion.process_confirmed_upload(
                filename,
                data,
                contract,
                # Re-approval may change a business key. Replacing this
                # source prevents stale rows from the old mapping remaining.
                replace_source=True,
            )
            results.append(
                {
                    "success": True,
                    "blob_path": blob_path,
                    "filename": filename,
                    "processing": processing,
                }
            )
        except Exception as exc:
            results.append(
                {
                    "success": False,
                    "blob_path": blob_path,
                    "error": str(exc),
                }
            )
    return results


@router.get("")
async def list_mappings():
    """
    Every mapping the review screen can show, in one shape.

    Confirmed GCS contracts first, then proposals still awaiting approval.
    """

    def collect() -> list[dict]:
        packets = []
        confirmed = storage.list_mapping_fingerprints("confirmed")
        # A pending copy whose cleanup failed at approval is superseded by its
        # confirmed one; listing both would show the mapping twice.
        pending = [
            fingerprint
            for fingerprint in storage.list_mapping_fingerprints("pending")
            if fingerprint not in confirmed
        ]
        for state, fingerprints, path_for in (
            ("confirmed", confirmed, storage.confirmed_mapping_path),
            ("pending", pending, storage.pending_mapping_path),
        ):
            for fingerprint in fingerprints:
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
    envelope, state = await asyncio.to_thread(_load_envelope, fingerprint)
    if not envelope:
        raise HTTPException(
            status_code=404, detail="No mapping found for that fingerprint."
        )

    # The SKU master (read-only) for the review screen's product-code table: a
    # reviewer picks which master SKU each of the file's codes is.
    master_skus = await asyncio.to_thread(generate_mapping.fetch_master_skus)

    # The raw contract rides along only here, not in the listing: it is what is
    # actually stored, and a single-mapping view is where seeing it is worth
    # the bytes.
    return {
        **mapping_view.envelope_to_packet(fingerprint, envelope, state),
        "contract": envelope.get("contract") or {},
        "proposedAt": envelope.get("proposed_at"),
        "masterSkus": master_skus or [],
        "masterSkusAvailable": master_skus is not None,
    }


@router.post("/{fingerprint}/preview")
async def preview_mapping(fingerprint: str, body: PreviewRequest):
    """
    Check these rules against the example file before they are stored.

    The checks run again on the rules as edited (every product code a master
    SKU, rule values covered, required fields filled...), so the reviewer
    sees whether an edit fixed what failed. Output rows are shown only for a
    mapping today's transformation can run (version 1); a version 2 contract
    is instructions the transformation will carry out later.
    """
    envelope, _ = await asyncio.to_thread(_load_envelope, fingerprint)
    if not envelope:
        raise HTTPException(
            status_code=404, detail="No mapping found for that fingerprint."
        )
    if not envelope.get("example_file"):
        raise HTTPException(
            status_code=409,
            detail="This mapping has no example file stored, so it cannot be previewed.",
        )

    proposed = _proposed_contract(envelope, body.rules, body.contract)

    def build() -> dict:
        filename, data, frame, layout = _example_table(envelope)
        validated = mapping_contract.validate_contract(
            proposed,
            list(frame.columns),
            envelope.get("target_schema", generate_mapping.TARGET_SCHEMA),
            trust_review=True,
            samples=mapping_view.validation_values(envelope),
        )
        checks = generate_mapping.check_contract(
            frame, layout, validated, filename, generate_mapping.fetch_master_skus()
        )
        result = {
            "columns": [],
            "rows_total": 0,
            "preview": [],
            "checks": checks,
            "warnings": validated["warnings"],
            "sku_codes": mapping_checks.sku_codes(frame, validated),
        }

        # A version 1 mapping still runs through today's transformation,
        # unchanged, so its rows can be shown.
        v1 = None if mapping_contract.is_v2(envelope.get("contract")) else mapping_contract.downgrade(validated)
        if v1 is not None:
            dataframe = contract_application.read_source_dataframe(filename, data)
            mapped = contract_application.apply_contract(dataframe, v1)
            target_columns = [
                column
                for column in envelope.get("target_schema", generate_mapping.TARGET_SCHEMA)
                if column in mapped
            ]
            result.update({
                "columns": target_columns,
                "rows_total": len(mapped),
                "preview": contract_application.preview_rows(mapped[target_columns], body.limit),
            })
        return result

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

    The contract is re-validated and re-checked here rather than trusted as
    sent, because this is the last gate before it becomes the contract every
    future file with this layout gets run through. A product code that is not
    a master SKU blocks it: the reviewer fixes the code table, or the product
    is added to the SKU master first.
    """
    # Confirmed first, as every other lookup does: a pending copy whose cleanup
    # failed must not become the base of an amendment.
    envelope_before, state = await asyncio.to_thread(_load_envelope, fingerprint)
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

    proposed = _proposed_contract(pending, body.rules, body.contract)

    contract = generate_mapping.validate_contract(
        proposed,
        pending["raw_columns"],
        pending.get("target_schema", generate_mapping.TARGET_SCHEMA),
        trust_review=True,
        samples=mapping_view.validation_values(pending),
    )

    if all(entry["status"] != "mapped" for entry in contract["fields"].values()):
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Contract is empty after validation — nothing to store.",
                "warnings": contract["warnings"],
            },
        )

    required_missing = mapping_view.required_missing_fields(contract)
    if required_missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "Required ingest fields are missing: "
                    + ", ".join(required_missing)
                ),
                "warnings": contract["warnings"],
            },
        )

    unreviewed = generate_mapping.unreviewed_low_confidence(contract)
    if unreviewed:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "Confirm every low-confidence field before approving: "
                    + ", ".join(unreviewed)
                ),
                "warnings": contract["warnings"],
            },
        )

    # The checks again, on the example file, against the SKU master as it is
    # now. Without an example file there is nothing to check against.
    def recheck() -> list[dict]:
        table = _example_table(pending)
        if table is None:
            return []
        filename, _, frame, layout = table
        return generate_mapping.check_contract(
            frame, layout, contract, filename, generate_mapping.fetch_master_skus()
        )

    try:
        checks = await asyncio.to_thread(recheck)
    except FileNotFoundError:
        checks = []
    failed = mapping_checks.failures(checks)
    if failed:
        raise HTTPException(
            status_code=422,
            detail={
                "message": " ".join(check["message"] for check in failed),
                "warnings": contract["warnings"],
            },
        )

    # What the reviewer changed against what the model proposed, kept so the
    # prompt can be improved from real corrections. Each approval is a new
    # version; the one it replaces is archived by the move below.
    reviewer_diff = mapping_contract.contract_diff(
        pending.get("proposal") or pending.get("contract") or {}, contract
    )

    # A mapping confirmed in version 1 (FairPrice) is written back in version
    # 1 when the amendment fits it, so today's transformation keeps running it.
    stored_contract = {key: value for key, value in contract.items() if key != "warnings"}
    if not mapping_contract.is_v2(pending.get("contract")):
        stored_contract = mapping_contract.downgrade(contract) or stored_contract

    envelope = {
        **pending,
        "contract": stored_contract,
        "name": name,
        "vendor": vendor,
        "version": int(pending.get("version") or 0) + 1 if state == "confirmed" else 1,
        "edited_by_user": bool(reviewer_diff),
        "reviewer_diff": reviewer_diff,
        "checks": checks or pending.get("checks") or [],
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

    # Files uploaded before approval were intentionally held back. Apply the
    # now-confirmed contract and load them without requiring a second upload,
    # when today's transformation can run it.
    ingestion = await asyncio.to_thread(
        _ingest_waiting_uploads,
        uploads.get("matched", []),
        stored_contract,
    )

    return {
        "success": True,
        "fingerprint": fingerprint,
        "name": name,
        "vendor": vendor,
        "stored_at": move["stored_at"],
        "moved_from": move["pending_path"],
        "moved_to": move["confirmed_path"],
        "archived_previous": move.get("archived_path"),
        "version": envelope["version"],
        "contract_format": 2 if mapping_contract.is_v2(stored_contract) else 1,
        # Uploads of a version 2 mapping stay stored until the transformation
        # can run that format.
        "awaiting_transformation": mapping_contract.is_v2(stored_contract),
        "pending_removed": move["removed_pending"],
        "uploads_updated": len(uploads["updated"]),
        "uploads_processed": sum(item["success"] for item in ingestion),
        "uploads_failed": sum(not item["success"] for item in ingestion),
        "processing": ingestion,
        "contract": stored_contract,
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
