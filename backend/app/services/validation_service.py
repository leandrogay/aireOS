from typing import Any, Dict

import pandas as pd

from app.schemas.sellout import (
    BUSINESS_COLUMNS,
    DATE_COLUMNS,
    NUMERIC_COLUMNS,
    REQUIRED_COLUMNS,
)
from app.services.mapping_service import TARGET_SCHEMA, apply_existing_mapping


def validate_mapped_dataframe(mapped: pd.DataFrame) -> Dict[str, Any]:
    """Standardise any mapped dataframe and separate invalid rows."""
    mapped = mapped.reindex(columns=BUSINESS_COLUMNS).reset_index(drop=True).copy()

    text_columns = [
        column
        for column in BUSINESS_COLUMNS
        if column not in DATE_COLUMNS + NUMERIC_COLUMNS
    ]
    for field in text_columns:
        mapped[field] = mapped[field].astype("string").str.strip()
        mapped[field] = mapped[field].mask(mapped[field].eq(""))

    failed_indices = set()
    rejection_reasons = []

    for field in REQUIRED_COLUMNS:
        missing = mapped[field].isna()
        count = int(missing.sum())
        if count:
            failed_indices.update(mapped.index[missing].tolist())
            rejection_reasons.append(f"{count} rows missing {field}")

    invalid_period_type = mapped["period_type"].notna() & ~mapped["period_type"].isin(
        ["week", "month"]
    )
    if invalid_period_type.any():
        count = int(invalid_period_type.sum())
        failed_indices.update(mapped.index[invalid_period_type].tolist())
        rejection_reasons.append(f"{count} rows with invalid period_type")

    for field in DATE_COLUMNS:
        parsed = pd.to_datetime(mapped[field], errors="coerce")
        invalid = parsed.isna()
        count = int(invalid.sum())
        if count:
            failed_indices.update(mapped.index[invalid].tolist())
            rejection_reasons.append(f"{count} rows with invalid {field} format")
        mapped[field] = parsed.dt.strftime("%Y-%m-%d")

    for field in NUMERIC_COLUMNS:
        parsed = pd.to_numeric(mapped[field], errors="coerce")
        invalid = parsed.isna() & mapped[field].notna()
        if field == "pack_size":
            non_integer = parsed.notna() & parsed.mod(1).ne(0)
            invalid = invalid | non_integer
        count = int(invalid.sum())
        if count:
            failed_indices.update(mapped.index[invalid].tolist())
            rejection_reasons.append(f"{count} rows with invalid numeric {field}")
        mapped[field] = parsed.mask(invalid)

    # Cloud SQL and BigQuery both define pack_size as an integer. Pandas needs
    # its nullable integer dtype so missing values remain null rather than
    # forcing the entire column to floating point.
    mapped["pack_size"] = mapped["pack_size"].astype("Int64")

    valid_df = mapped.drop(index=list(failed_indices)).reset_index(drop=True)
    rejected = len(failed_indices)
    summary = ""
    if rejected:
        summary = f"{rejected} rows rejected: {', '.join(rejection_reasons)}"

    return {
        "valid_df": valid_df,
        "total_rows": len(mapped),
        "rows_ingested": len(valid_df),
        "total_rejected": rejected,
        "rejection_summary": summary,
    }


def process_and_validate(
    df: pd.DataFrame, mapping: Dict[str, Any], filename: str
) -> Dict[str, Any]:
    """Map a recognised file, then reject rows that violate the target schema."""
    mapped = apply_existing_mapping(df.drop_duplicates(), mapping, filename)
    if list(mapped.columns) != TARGET_SCHEMA:
        raise ValueError("Mapping output does not conform to the target schema.")

    return validate_mapped_dataframe(mapped)
