from typing import Any, Dict

import pandas as pd

from app.services.mapping_service import TARGET_SCHEMA, apply_existing_mapping


REQUIRED_FIELDS = ["period_start", "period_end", "period_type", "retailer", "sku"]


def process_and_validate(
    df: pd.DataFrame, mapping: Dict[str, Any], filename: str
) -> Dict[str, Any]:
    """Map a recognised file, then reject rows that violate the target schema."""
    mapped = apply_existing_mapping(df.drop_duplicates(), mapping, filename)
    if list(mapped.columns) != TARGET_SCHEMA:
        raise ValueError("Mapping output does not conform to the target schema.")

    failed_indices = set()
    rejection_reasons = []

    for field in REQUIRED_FIELDS:
        missing = mapped[field].isna() | mapped[field].astype("string").str.strip().eq("")
        count = int(missing.sum())
        if count:
            failed_indices.update(mapped.index[missing].tolist())
            rejection_reasons.append(f"{count} rows missing {field}")

    for field in ["period_start", "period_end"]:
        parsed = pd.to_datetime(mapped[field], errors="coerce")
        invalid = parsed.isna()
        count = int(invalid.sum())
        if count:
            failed_indices.update(mapped.index[invalid].tolist())
            rejection_reasons.append(f"{count} rows with invalid {field} format")
        mapped[field] = parsed.dt.strftime("%Y-%m-%d")

    for field in ["pack_size", "quantity_units", "revenue"]:
        parsed = pd.to_numeric(mapped[field], errors="coerce")
        invalid = parsed.isna() & mapped[field].notna()
        count = int(invalid.sum())
        if count:
            failed_indices.update(mapped.index[invalid].tolist())
            rejection_reasons.append(f"{count} rows with invalid numeric {field}")
        mapped[field] = parsed

    valid_df = mapped.drop(index=list(failed_indices)).reset_index(drop=True)
    rejected = len(failed_indices)
    summary = ""
    if rejected:
        summary = f"{rejected} rows rejected: {', '.join(rejection_reasons)}"

    return {
        "valid_df": valid_df[TARGET_SCHEMA],
        "total_rows": len(mapped),
        "rows_ingested": len(valid_df),
        "total_rejected": rejected,
        "rejection_summary": summary,
    }
