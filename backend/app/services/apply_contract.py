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

    # A confirmed contract is commonly reapplied to a later file covering a
    # different reporting range -- same header shape, new or additional
    # dates -- so the literal columns recorded at confirm time can be a
    # strict subset of what this file actually has. Re-matching each group's
    # own period_extract_regex against the current columns (rather than
    # trusting the frozen list) is what lets a newly-added week's column get
    # melted in too instead of silently dropped; the regex was written with
    # a capture group precisely so it generalises across date values.
    resolved_groups = []
    for group in melt_groups:
        target_field = group.get("target_field")
        stored_columns = group.get("columns") or []
        pattern = group.get("period_extract_regex")
        date_format = group.get("date_format")
        if not target_field or not stored_columns or not pattern or not date_format:
            raise ContractApplicationError(
                "Each melt group requires target_field, columns, "
                "period_extract_regex and date_format."
            )

        compiled = re.compile(pattern)
        columns = [c for c in dataframe.columns if compiled.search(str(c))]
        if not columns:
            raise ContractApplicationError(
                f"No columns in this file match the stored period pattern "
                f"for {target_field!r}."
            )

        resolved_groups.append({**group, "columns": columns})

    # Two groups' regexes can each validly match their own literal columns at
    # confirm time yet still overlap once re-matched against a differently
    # dated file (validate_contract only warns about this, since it can't
    # know in advance whether a future file will actually trigger it). Left
    # unchecked, an overlapping column gets melted into both groups and the
    # merge below silently cross-multiplies rows -- wrong values, not just a
    # missing row. Fail loudly instead: the caller falls back to regenerating
    # a properly scoped contract rather than trusting corrupted output.
    column_owner: dict[str, str] = {}
    for group in resolved_groups:
        for column in group["columns"]:
            owner = column_owner.get(column)
            if owner and owner != group["target_field"]:
                raise ContractApplicationError(
                    f"Column {column!r} matches the period pattern for both "
                    f"{owner!r} and {group['target_field']!r} -- this contract's "
                    f"period_extract_regex values are not scoped tightly enough "
                    f"to reuse safely against this file."
                )
            column_owner[column] = group["target_field"]

    melt_columns = {column for group in resolved_groups for column in group["columns"]}

    if id_vars is None:
        id_vars = [column for column in dataframe.columns if column not in melt_columns]

    if not resolved_groups:
        return dataframe[id_vars].rename(columns=identity_mapping).copy()

    melted_tables = []
    for group in resolved_groups:
        target_field = group["target_field"]
        columns = group["columns"]
        pattern = group["period_extract_regex"]
        date_format = group["date_format"]

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
