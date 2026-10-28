"""Map, validate, and store one upload through a confirmed GCS contract."""

import pandas as pd

from app.services import (
    apply_contract,
    layout_detection,
    mapping_contract,
    sellout_service,
    validation_service,
)


def transform_confirmed_upload(
    filename: str,
    data: bytes,
    contract: dict,
) -> pd.DataFrame:
    """Read and transform one upload through either contract format."""
    if mapping_contract.is_v2(contract):
        try:
            dataframe, _ = layout_detection.read_table(filename, data)
        except layout_detection.LayoutError as exc:
            raise apply_contract.ContractApplicationError(str(exc)) from exc
    else:
        dataframe = apply_contract.read_source_dataframe(filename, data)
    return apply_contract.apply_contract(
        dataframe,
        contract,
        source_file=filename,
    )


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
