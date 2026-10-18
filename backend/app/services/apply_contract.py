"""Deterministically apply an approved mapping contract to uploaded data."""

import io
import re
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


def _apply_transformation(
    series: pd.Series, target: str, transformation: dict[str, Any]
) -> pd.Series:
    """Apply one validated generic operation to a mapped target column."""
    operation = transformation.get("type")

    if operation == "regex_extract":
        pattern = re.compile(transformation["pattern"])
        group = transformation.get("group", 1)

        def extract(value):
            if pd.isna(value) or str(value).strip() == "":
                return value
            match = pattern.search(str(value))
            return match.group(group) if match else pd.NA

        result = series.map(extract)
        unmatched = (
            series.notna()
            & series.astype("string").str.strip().ne("")
            & result.isna()
        )
        if unmatched.any():
            raise ContractApplicationError(
                f"regex_extract for {target!r} did not match {int(unmatched.sum())} value(s)."
            )
        return result

    if operation == "value_map":
        case_sensitive = transformation.get("case_sensitive", False)
        values = transformation.get("values") or {}
        lookup = {
            (key if case_sensitive else key.casefold()): value
            for key, value in values.items()
        }
        has_default = "default" in transformation
        default = transformation.get("default")
        missing = []

        def translate(value):
            if pd.isna(value) or str(value).strip() == "":
                return value
            text = str(value).strip()
            key = text if case_sensitive else text.casefold()
            if key in lookup:
                return lookup[key]
            if has_default:
                return default
            missing.append(text)
            return pd.NA

        result = series.map(translate)
        if missing:
            examples = sorted(set(missing))[:3]
            raise ContractApplicationError(
                f"value_map for {target!r} has no mapping or default for: {examples}"
            )
        return result

    raise ContractApplicationError(
        f"Unsupported transformation type for {target!r}: {operation!r}"
    )


def _apply_identity_mapping(
    frame: pd.DataFrame,
    identity_mapping: dict[str, Any],
    transformations: dict[str, dict] | None = None,
) -> pd.DataFrame:
    """
    Rename each source column to the target field it fills.

    One column may fill several fields: an article description carries the
    product name and the size in the same string. A rename cannot express
    that -- it moves a column, it does not copy one -- so the first target is
    renamed and every further target gets its own copy of the column.

    Once every target has its own column, optional transformations are applied
    by target name. Their configuration comes from the GCS contract.
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
        result[extra] = result[filled]

    for target, transformation in (transformations or {}).items():
        if target not in result:
            raise ContractApplicationError(
                f"Transformation target is missing after mapping: {target!r}"
            )
        result[target] = _apply_transformation(result[target], target, transformation)

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
    transformations = contract.get("transformations") or {}
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
        return _apply_identity_mapping(
            dataframe[id_vars].copy(), identity_mapping, transformations
        )

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

    return _apply_identity_mapping(result, identity_mapping, transformations)
