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
        return dataframe[id_vars].rename(columns=identity_mapping).copy()

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

    return result.rename(columns=identity_mapping)
