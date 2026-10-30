"""Map, validate, and store one upload through a confirmed GCS contract."""

import pandas as pd

from app.services import (
    apply_contract,
    layout_detection,
    mapping_contract,
    sellout_service,
    validation_service,
)

# Sample rows the load confirmation shows per file, as many as the review
# screen's "Sample sales rows".
PREVIEW_ROWS = 5


def transform_confirmed_upload(
    filename: str,
    data: bytes,
    contract: dict,
) -> pd.DataFrame:
    """Read and transform one upload through either contract format."""
    layout = None
    if mapping_contract.is_v2(contract):
        try:
            dataframe, layout = layout_detection.read_table(filename, data)
        except layout_detection.LayoutError as exc:
            raise apply_contract.ContractApplicationError(str(exc)) from exc
    else:
        dataframe = apply_contract.read_source_dataframe(filename, data)
    return apply_contract.apply_contract(
        dataframe,
        contract,
        source_file=filename,
        layout=layout,
    )


def preview_confirmed_upload(
    filename: str,
    data: bytes,
    contract: dict,
    *,
    replace_source: bool = False,
) -> dict:
    """
    What process_confirmed_upload would store, and what it would replace or
    overwrite in sell-out, without writing anything. The same transform and
    validation run, so the counts are the ones the load will use.
    """
    normalized = transform_confirmed_upload(filename, data, contract)
    validated = validation_service.validate_mapped_dataframe(normalized)
    valid_rows = validated["valid_df"]
    summary = sellout_service.summarize_clean_rows(valid_rows)

    # Without the database there is nothing stored to overlap with, and the
    # load itself would store nothing either.
    overlap = None
    if sellout_service.cloud_sql_loading_enabled():
        overlap = sellout_service.existing_overlap(valid_rows, replace_source=replace_source)

    return {
        "rows_total": validated["total_rows"],
        "rows_rejected": validated["total_rejected"],
        "rejection_summary": validated["rejection_summary"],
        "rows_to_store": summary["rows_stored"],
        "rows_consolidated": summary["rows_consolidated"],
        "retailers": summary["retailers"],
        "sku_count": summary["sku_count"],
        "first_period": summary["first_period"].isoformat() if summary["first_period"] else None,
        "last_period": summary["last_period"].isoformat() if summary["last_period"] else None,
        "rows_replaced": overlap["rows_replaced"] if overlap else 0,
        "overwrites": overlap["overwrites"] if overlap else [],
        "storage_enabled": overlap is not None,
        # What the stored rows will look like, as the review screen's sample:
        # the person sees the data itself before confirming, not only counts.
        "period_types": sorted(valid_rows["period_type"].dropna().unique().tolist()) if "period_type" in valid_rows else [],
        "columns": list(valid_rows.columns),
        "preview": apply_contract.preview_rows(valid_rows, PREVIEW_ROWS),
    }


def process_confirmed_upload(
    filename: str,
    data: bytes,
    contract: dict,
    *,
    replace_source: bool = False,
    source_blob: str | None = None,
    content_hash: str | None = None,
    mapping_fingerprint: str | None = None,
) -> dict:
    """Return processing details after safely loading valid rows to Cloud SQL."""
    normalized = transform_confirmed_upload(filename, data, contract)
    validated = validation_service.validate_mapped_dataframe(normalized)
    valid_rows = validated["valid_df"]

    if sellout_service.cloud_sql_loading_enabled():
        storage = sellout_service.load_clean_rows(
            valid_rows,
            replace_source=replace_source,
            data_source=contract.get("data_source") or "aireos_upload",
            source_blob=source_blob,
            content_hash=content_hash,
            mapping_fingerprint=mapping_fingerprint,
        )
    else:
        storage = {
            "rows_stored": 0,
            "rows_consolidated": 0,
            "storage_status": "disabled",
        }

    return {
        "rows_total": validated["total_rows"],
        "rows_mapped": validated["rows_ingested"],
        "rows_rejected": validated["total_rejected"],
        "rejection_summary": validated["rejection_summary"],
        "columns": list(valid_rows.columns),
        "preview": apply_contract.preview_rows(valid_rows),
        **storage,
    }
