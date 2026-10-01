"""Map, validate, and store one upload through a confirmed GCS contract."""

from app.services import apply_contract, sellout_service, validation_service


def process_confirmed_upload(
    filename: str,
    data: bytes,
    contract: dict,
    *,
    replace_source: bool = False,
) -> dict:
    """Return processing details after safely loading valid rows to Cloud SQL."""
    dataframe = apply_contract.read_source_dataframe(filename, data)
    normalized = apply_contract.apply_contract(dataframe, contract)
    normalized["source_file"] = filename
    validated = validation_service.validate_mapped_dataframe(normalized)
    valid_rows = validated["valid_df"]

    if sellout_service.cloud_sql_loading_enabled():
        storage = sellout_service.load_clean_rows(
            valid_rows,
            replace_source=replace_source,
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
