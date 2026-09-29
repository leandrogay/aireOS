"""Deterministically apply an approved mapping contract to uploaded data."""

import io
from pathlib import Path
from typing import Any
import pandas as pd


class ContractApplicationError(ValueError):
    """The approved contract cannot be applied safely to the uploaded file."""


def read_source_dataframe(filename: str, data: bytes) -> pd.DataFrame:
    """Read a supported upload into a dataframe while preserving identifiers."""
    extension = Path(filename).suffix.lower()
    source = io.BytesIO(data)

    try:
        if extension in (".xlsx", ".xlsm", ".xls"):
            return pd.read_excel(source, dtype=str)
        if extension == ".csv":
            return pd.read_csv(source, dtype=str)
        if extension == ".txt":
            return pd.read_csv(source, sep=None, engine="python", dtype=str)
    except Exception as exc:
        raise ContractApplicationError(
            f"Could not read data from {filename!r}: {exc}"
        ) from exc

    raise ContractApplicationError(
        f"Unsupported file format for mapping: {extension or '(none)'}"
    )


def preview_rows(dataframe: pd.DataFrame, limit: int = 3) -> list[dict[str, Any]]:
    """
    Return a small JSON-safe sample of mapped output without exposing the
    whole upload.

    Dates are rendered as strings and NaN as null, because the caller is JSON
    and neither survives the trip otherwise.
    """
    preview = dataframe.head(limit).copy()
    for column in preview.select_dtypes(include=["datetime", "datetimetz"]).columns:
        preview[column] = preview[column].dt.strftime("%Y-%m-%d")
    preview = preview.astype(object).where(preview.notna(), None)
    return preview.to_dict(orient="records")


def _apply_identity_mapping(
    frame: pd.DataFrame, identity_mapping: dict[str, Any]
) -> pd.DataFrame:
    """
    Rename each source column to the target field it fills.

    One column may fill several fields: an article description carries the
    product name and the size in the same string. A rename cannot express
    that -- it moves a column, it does not copy one -- so the first target is
    renamed and every further target gets its own copy of the column.

    =========================================================================
    THE PER-FIELD TRANSFORMATION GOES HERE.

    Every field a column fills currently receives that column's value
    verbatim. For a column that fills one field that is usually right. For a
    column that fills several it is right for at most one of them: mapping
    "Article Description" to both product_name and size puts the whole
    string "VEXA ADULT PANTS XL 10S" into both, when size should read "XL".

    So this is the seam. Each (source column, target field) pair is the unit
    a transform applies to, and the loop below is where one would run --
    cleaning the product name for product_name, pulling the size token out
    for size, leaving a straight copy where no transform is configured.

    Where the transform itself should be recorded is open: alongside the
    target in the contract is the obvious place, and mapping_view already
    carries a per-rule "transform" field through to the review screen, so the
    UI has somewhere to put one. mapping_service.clean_product_name,
    extract_size and title_case are existing implementations of exactly the
    three transforms this file's own FairPrice mapping needs.
    =========================================================================
    """
    from app.services.generate_mapping import normalize_targets

    renames: dict[str, str] = {}
    copies: list[tuple[str, str]] = []

    for source, value in identity_mapping.items():
        targets = normalize_targets(value)
        if not targets:
            continue
        renames[source] = targets[0]
        copies.extend((targets[0], extra) for extra in targets[1:])

    result = frame.rename(columns=renames)

    for filled, extra in copies:
        # Untransformed on purpose -- see above.
        result[extra] = result[filled]

    return result


def _period_type(group: dict[str, Any]) -> str | None:
    declared = str(group.get("period_type") or "").lower()
    if declared in ("week", "month"):
        return declared

    headers = [str(column).lower() for column in group.get("columns") or []]
    if headers and all("week" in header for header in headers):
        return "week"
    if headers and all("month" in header for header in headers):
        return "month"
    return None


def apply_contract(
    dataframe: pd.DataFrame,
    contract: dict[str, Any],
    id_vars: list[str] | None = None,
) -> pd.DataFrame:
    """Apply identity renames and wide-to-long melt groups without using AI."""
    identity_mapping = contract.get("identity_mapping") or {}
    melt_groups = contract.get("melt_groups") or []
    if not identity_mapping and not melt_groups:
        raise ContractApplicationError("Mapping contract is empty.")

    missing_identity = [column for column in identity_mapping if column not in dataframe]
    if missing_identity:
        raise ContractApplicationError(
            f"Identity source columns are missing: {missing_identity}"
        )

    melt_columns = {
        column
        for group in melt_groups
        for column in (group.get("columns") or [])
    }
    missing_melt = sorted(melt_columns - set(dataframe.columns))
    if missing_melt:
        raise ContractApplicationError(
            f"Melt source columns are missing: {missing_melt}"
        )

    if id_vars is None:
        id_vars = [column for column in dataframe.columns if column not in melt_columns]

    if not melt_groups:
        return _apply_identity_mapping(dataframe[id_vars].copy(), identity_mapping)

    melted_tables = []
    for group in melt_groups:
        target_field = group.get("target_field")
        columns = group.get("columns") or []
        pattern = group.get("period_extract_regex")
        date_format = group.get("date_format")
        if not target_field or not columns or not pattern or not date_format:
            raise ContractApplicationError(
                "Each melt group requires target_field, columns, "
                "period_extract_regex and date_format."
            )

        melted = pd.melt(
            dataframe,
            id_vars=id_vars,
            value_vars=columns,
            var_name="_source_column",
            value_name=target_field,
        )
        extracted = melted["_source_column"].str.extract(pattern, expand=False)
        if isinstance(extracted, pd.DataFrame):
            extracted = extracted.iloc[:, 0]
        if extracted.isna().any():
            raise ContractApplicationError(
                f"Period regex did not match every column for {target_field!r}."
            )

        melted["period_start"] = pd.to_datetime(
            extracted, format=date_format, errors="raise"
        )
        melted["period_type"] = _period_type(group)
        melted = melted.drop(columns=["_source_column"])
        melted_tables.append(melted)

    merge_keys = id_vars + ["period_start", "period_type"]
    result = melted_tables[0]
    for table in melted_tables[1:]:
        result = pd.merge(result, table, on=merge_keys, how="outer")

    metric_columns = [group["target_field"] for group in melt_groups]
    result = result.dropna(subset=metric_columns, how="all")
    result["period_end"] = result["period_start"]
    weekly = result["period_type"].eq("week")
    monthly = result["period_type"].eq("month")
    result.loc[weekly, "period_end"] = (
        result.loc[weekly, "period_start"] + pd.Timedelta(days=6)
    )
    result.loc[monthly, "period_end"] = (
        result.loc[monthly, "period_start"] + pd.offsets.MonthEnd(0)
    )

    return _apply_identity_mapping(result, identity_mapping)
