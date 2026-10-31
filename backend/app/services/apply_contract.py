"""Deterministically apply an approved mapping contract to uploaded data."""

import io
import re
from pathlib import Path
from typing import Any
import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import mapping_contract


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


def _labels(group: dict, layout: dict | None, columns: list[str]) -> dict[str, dict[str, str]]:
    """
    Each label field of a melt group and, per melted column, the cell above
    that column's header it reads (SingHealth's outlet code over its name).

    A melted column with no cell there fails the file: its rows would load
    with no store code and be counted as the retailer's "all stores".
    """
    labels = {}
    header_row = int((layout or {}).get("header_row") or 1)
    above = {item["row"]: item["cells"] for item in (layout or {}).get("rows_above_header") or []}
    for label in group.get("labels") or []:
        # No rows above: the header itself, read for a second field.
        if label["rows_above"] == 0:
            labels[label["target"]] = {column: column for column in columns}
            continue
        row = header_row - label["rows_above"]
        cells = above.get(row) or {}
        missing = [column for column in columns if column not in cells]
        if missing:
            raise ContractApplicationError(
                f"Melt group {group['id']!r} reads {label['target']!r} from row {row}, "
                f"which has nothing above {missing[:3]}."
            )
        labels[label["target"]] = {column: cells[column] for column in columns}
    return labels


def _melt(dataframe: pd.DataFrame, contract: dict, layout: dict | None) -> pd.DataFrame:
    """Reshape every approved melt group and retain its source row context."""
    groups = contract.get("melt_groups") or []
    source = dataframe.reset_index(drop=True).copy()
    source.insert(0, "_source_row", source.index)
    if not groups:
        return source

    columns = list(dataframe.columns)
    melted_tables = []
    for group in groups:
        selected = mapping_contract.resolve_selector(group["select"], columns)
        if not selected:
            raise ContractApplicationError(
                f"Melt group {group['id']!r} did not match any source columns."
            )

        melted = source[["_source_row", *selected]].melt(
            id_vars=["_source_row"],
            value_vars=selected,
            var_name="_source_column",
            value_name=group["value_target"],
        )
        key = group["key"]
        key_values = melted["_source_column"]
        if key.get("pattern"):
            extracted = key_values.str.extract(key["pattern"], expand=False)
            if isinstance(extracted, pd.DataFrame):
                extracted = extracted.iloc[:, 0]
            if extracted.isna().any():
                raise ContractApplicationError(
                    f"Key regex did not match every column in melt group {group['id']!r}."
                )
            key_values = extracted
        if key["target"] == "period_start":
            try:
                key_values = pd.to_datetime(
                    key_values,
                    format=key.get("date_format"),
                    errors="raise",
                )
            except Exception as exc:
                raise ContractApplicationError(
                    f"Could not read period headers in melt group {group['id']!r}: {exc}"
                ) from exc

        melted[key["target"]] = key_values
        for target, cells in _labels(group, layout, selected).items():
            melted[target] = melted["_source_column"].map(cells)
        melted = melted.drop(columns=["_source_column"])
        if group.get("period_type"):
            melted["_period_type"] = group["period_type"]
        melted_tables.append(melted)

    key_target = groups[0]["key"]["target"]
    merge_keys = ["_source_row", key_target]
    if all("_period_type" in table for table in melted_tables):
        merge_keys.append("_period_type")

    result = melted_tables[0]
    for table in melted_tables[1:]:
        duplicate_values = [
            column
            for column in table.columns
            if column in result.columns and column not in merge_keys
        ]
        if duplicate_values:
            raise ContractApplicationError(
                f"Melt groups fill the same output columns: {duplicate_values}"
            )
        result = result.merge(table, on=merge_keys, how="outer")

    raw_columns = [column for column in source.columns if column != "_source_row"]
    return result.merge(source[["_source_row", *raw_columns]], on="_source_row", how="left")


def _rule_matches(value: str, rule: dict, case_sensitive: bool) -> bool:
    """Whether one rules-transform condition matches one source value."""
    expected = rule["value"]
    actual = value
    if rule["op"] != "regex" and not case_sensitive:
        actual, expected = actual.casefold(), expected.casefold()
    if rule["op"] == "equals":
        return actual == expected
    if rule["op"] == "startswith":
        return actual.startswith(expected)
    if rule["op"] == "endswith":
        return actual.endswith(expected)
    if rule["op"] == "contains":
        return expected in actual
    flags = 0 if case_sensitive else re.IGNORECASE
    return bool(re.search(expected, actual, flags=flags))


def _apply_transform(
    series: pd.Series,
    target: str,
    transformation: dict,
    context: pd.DataFrame,
) -> pd.Series:
    """Apply one validated transform using source-row context."""
    operation = transformation["type"]
    if operation == "regex_extract":
        pattern = re.compile(transformation["pattern"])
        group = transformation.get("group", 1)

        def extract(value):
            if pd.isna(value) or str(value).strip() == "":
                return value
            match = pattern.search(str(value))
            return match.group(group) if match else pd.NA

        return series.map(extract)
    if operation == "value_map":
        case_sensitive = transformation.get("case_sensitive", False)
        values = transformation.get("values") or {}
        lookup = {
            (key if case_sensitive else key.casefold()): value
            for key, value in values.items()
        }
        has_default = "default" in transformation

        def translate(value):
            if pd.isna(value) or str(value).strip() == "":
                return value
            text = str(value).strip()
            key = text if case_sensitive else text.casefold()
            if key in lookup:
                return lookup[key]
            return transformation.get("default") if has_default else pd.NA

        return series.map(translate)
    if operation == "forward_fill":
        return series.ffill()
    if operation == "month_start":
        date_format = transformation.get("format")
        parsed = pd.to_datetime(series, format=date_format, errors="coerce")
        return parsed.dt.to_period("M").dt.to_timestamp()
    if operation == "zero_as_empty":
        numeric = pd.to_numeric(series, errors="coerce")
        return series.mask(numeric.eq(0))
    if operation == "negate":
        numeric = pd.to_numeric(series, errors="coerce")
        return -numeric
    if operation == "rules":
        values = context[transformation["column"]] if transformation.get("column") else series
        case_sensitive = transformation.get("case_sensitive", False)
        has_default = "default" in transformation
        def apply_rule(value):
            if pd.isna(value) or str(value).strip() == "":
                return value
            text = str(value).strip()
            for rule in transformation["rules"]:
                if _rule_matches(text, rule, case_sensitive):
                    return rule["output"]
            if has_default:
                return transformation.get("default")
            return pd.NA

        return values.map(apply_rule)
    if operation == "uom_factor":
        numeric = pd.to_numeric(series, errors="coerce")
        factor_source = context[transformation["column"]]
        factors = transformation.get("factors") or {}
        lookup = {str(key).casefold(): value for key, value in factors.items()}

        def factor_for(index):
            key = str(factor_source.loc[index]).strip().casefold()
            factor = lookup.get(key, transformation.get("default", 1))
            if isinstance(factor, dict):
                return pd.to_numeric(
                    pd.Series([context.loc[index, factor["column"]]]), errors="coerce"
                ).iloc[0]
            return factor

        factor_values = pd.Series(
            [factor_for(index) for index in numeric.index],
            index=numeric.index,
            dtype="float64",
        )
        return numeric * factor_values
    if operation == "multiply":
        numeric = pd.to_numeric(series, errors="coerce")
        return numeric * pd.to_numeric(context[transformation["column"]], errors="coerce")
    raise ContractApplicationError(
        f"Unsupported transformation type for {target!r}: {operation!r}"
    )


def _transformed_field(
    series: pd.Series,
    target: str,
    entry: dict,
    context: pd.DataFrame,
) -> pd.Series:
    result = series
    for transformation in entry.get("transforms") or []:
        result = _apply_transform(result, target, transformation, context)
    return result


def _aggregate(result: pd.DataFrame, aggregate: dict) -> pd.DataFrame:
    """Roll mapped rows up to the contract's declared grain."""
    if aggregate.get("period") == "month":
        result["period_start"] = (
            pd.to_datetime(result["period_start"], errors="coerce")
            .dt.to_period("M")
            .dt.to_timestamp()
        )

    keys = list(aggregate.get("by") or [])
    measures = list(aggregate.get("sum") or [])
    for measure in measures:
        result[measure] = pd.to_numeric(result[measure], errors="coerce")

    grouped = result.groupby(keys, dropna=False, sort=False)
    totals = grouped[measures].sum(min_count=1).reset_index()
    descriptive = [
        column
        for column in BUSINESS_COLUMNS
        if column in result and column not in keys + measures + ["period_end", "period_label"]
    ]
    if descriptive:
        details = grouped[descriptive].first().reset_index()
        totals = totals.merge(details, on=keys, how="left")
    return totals


def _derive_period_fields(result: pd.DataFrame) -> pd.DataFrame:
    periods = pd.to_datetime(result["period_start"], errors="coerce")
    result["period_start"] = periods
    result["period_end"] = periods
    weekly = result["period_type"].eq("week")
    monthly = result["period_type"].eq("month")
    result.loc[weekly, "period_end"] = periods[weekly] + pd.Timedelta(days=6)
    result.loc[monthly, "period_end"] = periods[monthly] + pd.offsets.MonthEnd(0)
    result["period_label"] = periods.dt.strftime("%Y-%m-%d")
    return result


def _stated_month(layout: dict | None) -> pd.Timestamp:
    """
    The calendar month the file states it covers above its table, for a
    contract that reads its period from there. A statement spanning several
    months cannot say which month a row belongs to.
    """
    stated = (layout or {}).get("stated_period")
    if not stated:
        raise ContractApplicationError(
            "The mapping reads the period from the file's title, but this file states no period."
        )
    start, end = pd.Timestamp(stated["start"]), pd.Timestamp(stated["end"])
    if start.to_period("M") != end.to_period("M"):
        raise ContractApplicationError(
            f"The file states the period {stated['start']} to {stated['end']}, which is more "
            "than one month, so its rows cannot be dated to a month."
        )
    return start.to_period("M").to_timestamp()


def apply_contract(
    dataframe: pd.DataFrame,
    contract: dict,
    *,
    source_file: str | None = None,
    layout: dict | None = None,
) -> pd.DataFrame:
    """
    Execute every instruction in one approved contract, deterministically and
    without using AI. `layout` is what layout detection found in the file
    (read_table); the contract reads its stated period and the cells above
    its header from there.
    """
    if not contract.get("fields"):
        raise ContractApplicationError("Mapping contract is empty.")

    working = _melt(dataframe, contract, layout)
    fields = contract["fields"]
    output = pd.DataFrame(index=working.index)

    for target, entry in fields.items():
        status = entry.get("status")
        if status == "mapped":
            source = entry.get("source") or target
            if source not in working:
                raise ContractApplicationError(
                    f"Mapped source for {target!r} is missing: {source!r}"
                )
            output[target] = _transformed_field(working[source], target, entry, working)
        elif status == "constant":
            output[target] = entry.get("value")
        elif status == "system":
            output[target] = source_file
        elif status == "not_available":
            output[target] = pd.NA
        elif status == "derived" and entry.get("from_layout") == "stated_period":
            output[target] = _stated_month(layout)
        elif target == "period_type" and status == "derived":
            if "_period_type" not in working:
                raise ContractApplicationError(
                    "period_type is derived but no period melt group supplies it."
                )
            output[target] = working["_period_type"]

    unresolved = {
        target: entry
        for target, entry in fields.items()
        if entry.get("status") == "derived" and entry.get("from_field")
    }
    while unresolved:
        progressed = False
        for target, entry in list(unresolved.items()):
            source = entry["from_field"]
            if source not in output:
                continue
            context = pd.concat([working, output], axis=1)
            output[target] = _transformed_field(output[source], target, entry, context)
            del unresolved[target]
            progressed = True
        if not progressed:
            raise ContractApplicationError(
                f"Derived fields have unresolved dependencies: {sorted(unresolved)}"
            )

    for field in BUSINESS_COLUMNS:
        if field not in output and field not in ("period_end", "period_label"):
            output[field] = pd.NA

    output = output.replace(r"^\s*$", pd.NA, regex=True)
    measures = [field for field in ("quantity_units", "revenue") if field in output]
    if measures:
        output = output.dropna(subset=measures, how="all")
    if contract.get("aggregate") and not output.empty:
        output = _aggregate(output, contract["aggregate"])
    output = _derive_period_fields(output)
    return output.reindex(columns=BUSINESS_COLUMNS).reset_index(drop=True)
