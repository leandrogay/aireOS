"""
The mapping contract: what it may say, and the validation that makes it safe
to store.

A contract is a set of instructions and nothing else. Mapping generation writes
it and a person reviews it; the transformation (a separate step) reads it and
does exactly what it says -- no business rule lives outside the contract.

A contract has one entry per target field, saying how that field is
filled -- so a field is never left out by accident, and "not in this file" is a
decision written down rather than an absence -- plus where the data sits in the
file and whether rows are rolled up:

    {
      "layout": {"sheet": "Sheet1", "sheet_position": 2, "header_row": 1,
                 "fill_down": [], "footer_label_pattern": "^(grand\\s+)?total\\b",
                 "subtotal_label_pattern": "^(grand\\s+|sub\\s*)?total$"},
      "fields": {
        "retailer": {"status": "mapped", "source": "Store Format",
                     "transforms": [{"type": "rules", "rules": [...], "default": "..."}]},
        "sku":      {"status": "mapped", "source": "Material",
                     "transforms": [{"type": "value_map",
                                     "values": {"0059-01-025-R": "13255045", ...}}]},
        "revenue":  {"status": "mapped", "melt_group": "sales"},
        "store_code": {"status": "not_available", "reason": "NHG reports no store"},
        ...
      },
      "melt_groups": [
        {"id": "sales",
         "select": {"kind": "pattern", "pattern": "^SALES \\| Month \\d+ \\| ..."},
         "key": {"target": "period_start", "pattern": "(\\d{2}-\\d{2}-\\d{4})$",
                 "date_format": "%d-%m-%Y"},
         "value_target": "revenue", "period_type": "month"}
      ],
      "aggregate": {"period": "month", "by": [...], "sum": ["quantity_units", "revenue"]},
      "data_source": "aireos_upload"
    }

Statuses:
  mapped         read from a source column, or from a melt group's key or value
  derived        computed: period_end / period_label from the period, period_type
                 from the melt headers, another field run through transforms
                 (`from_field`, e.g. retailer from the outlet code's _Ecomm suffix,
                 revenue as quantity times a per-unit price column), or the
                 period the file states above its table (`from_layout`:
                 "stated_period", SingHealth's "DATE : 01 Aug 2026 TO 31 Aug 2026")
  constant       the same `value` on every row (NHG's retailer)
  system         written by the pipeline (source_file)
  not_available  the file does not hold it; `reason` says why. Never invented.

A melt group's key is what each melted column's header says (a period, a store
code or a store name). Its `labels` read more of it: {"rows_above": 1,
"target": "store_code"} fills store_code from the cell directly above each
melted column, where SingHealth writes the outlet's code over its name, and
{"rows_above": 0, "target": "store_name"} reads the header itself again, so one
heading can fill both the store code and the store name.

The sku field's value_map is the product-code table: each retailer code in the
file and the master SKU it is. A field with no value_map uses the file's codes
as they are (FairPrice article numbers are the master codes).

Pure: no GCS, no database, no model.
"""

import copy
import re

import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS

FIELD_STATUSES = ("mapped", "derived", "constant", "system", "not_available")
CONFIDENCE_LEVELS = ("high", "medium", "low")

SYSTEM_FIELDS = ("source_file",)
# Computed from period_start and period_type on every contract.
PERIOD_DERIVED_FIELDS = ("period_end", "period_label")

# The fields a sell-out row cannot exist without. store_code is not one: NHG
# reports no store at all.
REQUIRED_FIELDS = ("period_start", "period_type", "retailer", "sku", "quantity_units")

# The fields whose decision belongs to a proposal or a reviewer. The rest are
# fixed: written by the pipeline, or computed from the period.
DECIDABLE_FIELDS = tuple(
    field for field in BUSINESS_COLUMNS if field not in SYSTEM_FIELDS + PERIOD_DERIVED_FIELDS
)

MEASURE_FIELDS = ("quantity_units", "revenue")
# What a melt group's headings -- or the cells above them (its labels) -- may
# fill besides the period: any descriptive field. An outlet's code and name,
# its format, the brand or product range a column stands for, the retailer
# channel, even the product code of a file with one column per product.
HEADING_FIELDS = tuple(
    field for field in DECIDABLE_FIELDS if field not in ("period_start", "period_type", "pack_size", *MEASURE_FIELDS)
)
MELT_KEY_TARGETS = ("period_start", *HEADING_FIELDS)
LABEL_TARGETS = HEADING_FIELDS
# What a field may be read from in the file's layout rather than its table.
LAYOUT_SOURCES = ("stated_period",)
PERIOD_TYPES = ("month", "week")
SELECTOR_KINDS = ("pattern", "between", "columns")
DATA_SOURCES = ("aireos_upload", "promo_claim")

# The roll-up instruction's grain: one row per these fields, measures summed.
AGGREGATE_KEY = ("period_start", "period_type", "retailer", "store_code", "sku")
AGGREGATE_PERIODS = ("month",)

# How layout detection marks footer and subtotal rows, recorded in the
# contract's layout so the transformation skips the same rows.
FOOTER_LABEL_PATTERN = r"^(grand\s+)?total\b"
SUBTOTAL_LABEL_PATTERN = r"^(grand\s+|sub\s*)?total$"
DEFAULT_DATA_SOURCE = "aireos_upload"

TRANSFORM_TYPES = (
    "regex_extract",
    "value_map",
    "rules",
    "negate",
    "uom_factor",
    "multiply",
    "month_start",
    "forward_fill",
    "zero_as_empty",
)
RULE_OPS = ("equals", "startswith", "endswith", "contains", "regex")


# ---- Reading a contract ----------------------------------------------------------

def read_contract(contract: dict | None) -> dict:
    """
    A copy of a contract with its fields and melt groups present, so a reader
    can look them up without checking for None. The caller's dict is never
    changed.
    """
    contract = copy.deepcopy(contract or {})
    contract.setdefault("fields", {})
    contract.setdefault("melt_groups", [])
    return contract


# ---- Selecting melt columns --------------------------------------------------------

def _same_header(a: str, b: str) -> bool:
    return " ".join(str(a).split()).casefold() == " ".join(str(b).split()).casefold()


def resolve_selector(select: dict, columns: list[str]) -> list[str]:
    """
    The columns a melt group's selector picks out of this file's headers.

      pattern   every header the regex matches -- next month's dates match too
      between   every column strictly between two marker headers -- an outlet
                added next month lands between them too
      columns   exactly these names (a detected group the review screen offers)

    Raises ValueError when the selector cannot be applied to these headers.
    """
    kind = (select or {}).get("kind")
    if kind == "pattern":
        compiled = re.compile(select.get("pattern") or "")
        return [column for column in columns if compiled.search(column)]
    if kind == "between":
        after, before = select.get("after"), select.get("before")
        start = next((i for i, c in enumerate(columns) if after and _same_header(c, after)), None)
        if start is None:
            raise ValueError(f"marker column {after!r} is not in the file")
        end = len(columns)
        if before:
            end = next(
                (i for i, c in enumerate(columns) if i > start and _same_header(c, before)),
                None,
            )
            if end is None:
                raise ValueError(f"marker column {before!r} is not in the file after {after!r}")
        return columns[start + 1 : end]
    if kind == "columns":
        listed = list(select.get("columns") or [])
        missing = [column for column in listed if column not in columns]
        if missing:
            raise ValueError(f"columns not found in file: {missing[:3]}")
        return listed
    raise ValueError(f"unsupported selector kind: {kind!r}")


def group_columns(contract: dict, columns: list[str]) -> dict[str, list[str]]:
    """Each melt group's id and the columns it selects in this file."""
    resolved = {}
    for group in contract.get("melt_groups") or []:
        try:
            resolved[group["id"]] = resolve_selector(group.get("select") or {}, columns)
        except (ValueError, re.error):
            resolved[group["id"]] = []
    return resolved


# ---- Validation ---------------------------------------------------------------------

def _clean_annotation(source: dict | None, trust_review: bool, default: str = "low") -> dict:
    """
    Normalise one decision's confidence, rationale and review flag.

    Anything the model omitted, misspelled or invented becomes `default` (low
    for a proposal's own decisions) with no rationale: treating an unreadable
    confidence as high would let a guess through the review gate on a
    formatting mistake.

    "reviewed" records that a person looked at the decision and stood by it.
    Only a reviewer's own submission may set it -- a model that wrote
    "reviewed": true would be approving its own guess.
    """
    raw = source or {}
    level = str(raw.get("confidence") or "").strip().lower()
    return {
        "confidence": level if level in CONFIDENCE_LEVELS else default,
        "rationale": str(raw.get("rationale") or "").strip(),
        "reviewed": trust_review and raw.get("reviewed") is True,
    }


def _validate_regex_extract(target, raw, values, reject):
    pattern = raw.get("pattern")
    group = raw.get("group", 1)
    try:
        compiled = re.compile(pattern or "")
    except (re.error, TypeError) as exc:
        return reject(f"Dropped transformation for {target!r} — invalid regex: {exc}")
    if not pattern or compiled.groups < 1:
        return reject(f"Dropped transformation for {target!r} — regex needs a capture group")
    if not isinstance(group, int) or isinstance(group, bool) or not 1 <= group <= compiled.groups:
        return reject(
            f"Dropped transformation for {target!r} — group must identify an existing capture group"
        )

    bad = []
    for value in values:
        text = str(value)
        match = compiled.search(text)
        if not match:
            bad.append(text)
            continue
        start, end = match.span(group)
        if (start > 0 and text[start - 1] == "/") or (end < len(text) and text[end] == "/"):
            bad.append(text)
    if bad:
        return reject(
            f"Dropped transformation for {target!r} — regex does not "
            f"extract a complete value from source samples: {bad[:3]}"
        )
    return {"type": "regex_extract", "pattern": pattern, "group": group}


def _validate_value_map(target, raw, values, source, reject):
    mapping = raw.get("values")
    if not isinstance(mapping, dict) or not mapping:
        return reject(f"Dropped transformation for {target!r} — value_map needs at least one value")
    cleaned = {
        str(key).strip(): str(output).strip()
        for key, output in mapping.items()
        if str(key).strip() and str(output).strip()
    }
    if not cleaned:
        return reject(f"Dropped transformation for {target!r} — value_map has no usable values")

    case_sensitive = bool(raw.get("case_sensitive", False))
    if values:
        normalize = (lambda value: value) if case_sensitive else str.casefold
        observed = {normalize(str(value).strip()) for value in values}
        if observed.isdisjoint({normalize(key) for key in cleaned}):
            return reject(
                f"Dropped transformation for {target!r} — none of its "
                f"value_map keys occur in source column {source!r}"
            )

    transform = {"type": "value_map", "values": cleaned, "case_sensitive": case_sensitive}
    if str(raw.get("default") or "").strip():
        transform["default"] = str(raw["default"]).strip()
    return transform


def _validate_rules(target, raw, raw_columns, reject):
    rules = []
    for rule in raw.get("rules") or []:
        if not isinstance(rule, dict):
            continue
        op = str(rule.get("op") or "").strip().lower()
        value = str(rule.get("value") if rule.get("value") is not None else "").strip()
        output = str(rule.get("output") if rule.get("output") is not None else "").strip()
        if op not in RULE_OPS or not value or not output:
            return reject(
                f"Dropped transformation for {target!r} — every rule needs an op "
                f"({', '.join(RULE_OPS)}), a value and an output"
            )
        if op == "regex":
            try:
                re.compile(value)
            except re.error as exc:
                return reject(f"Dropped transformation for {target!r} — invalid rule regex: {exc}")
        rules.append({"op": op, "value": value, "output": output})
    if not rules:
        return reject(f"Dropped transformation for {target!r} — rules needs at least one rule")

    transform = {
        "type": "rules",
        "rules": rules,
        "case_sensitive": bool(raw.get("case_sensitive", False)),
    }
    if str(raw.get("default") or "").strip():
        transform["default"] = str(raw["default"]).strip()
    column = raw.get("column")
    if column:
        if column not in raw_columns:
            return reject(f"Dropped transformation for {target!r} — rule column {column!r} is not in the file")
        transform["column"] = column
    return transform


def _validate_uom_factor(target, raw, raw_columns, reject):
    column = raw.get("column")
    if column not in raw_columns:
        return reject(f"Dropped transformation for {target!r} — uom_factor column {column!r} is not in the file")
    factors = {}
    for uom, factor in (raw.get("factors") or {}).items():
        if isinstance(factor, dict) and factor.get("column") in raw_columns:
            factors[str(uom).strip()] = {"column": factor["column"]}
        elif isinstance(factor, (int, float)) and not isinstance(factor, bool) and factor > 0:
            factors[str(uom).strip()] = factor
        else:
            return reject(
                f"Dropped transformation for {target!r} — factor for {uom!r} must be a "
                "positive number or a column of the file"
            )
    default = raw.get("default", 1)
    if not isinstance(default, (int, float)) or isinstance(default, bool) or default <= 0:
        default = 1
    return {"type": "uom_factor", "column": column, "factors": factors, "default": default}


def _validate_multiply(target, raw, raw_columns, reject):
    """Each value times the same row's value in another column (units x price)."""
    column = raw.get("column")
    if column not in raw_columns:
        return reject(f"Dropped transformation for {target!r} — multiply column {column!r} is not in the file")
    return {"type": "multiply", "column": column}


def validate_transforms(
    target: str,
    transforms,
    raw_columns: list[str],
    values: list[str],
    source: str | None,
    warnings: list[str],
) -> list[dict] | None:
    """
    A field's transforms, each checked; None when any is unsafe.

    A field whose transform is rejected is not passed through untransformed --
    that would be a different mapping from the one proposed -- so the caller
    drops the field to not_available and the reviewer sees why.
    """
    if transforms is None:
        return []
    if isinstance(transforms, dict):
        transforms = [transforms]
    if not isinstance(transforms, list):
        warnings.append(f"Dropped transformation for {target!r} — configuration must be a list")
        return None

    def reject(message):
        warnings.append(message)
        return None

    clean = []
    for raw in transforms:
        if not isinstance(raw, dict):
            warnings.append(f"Dropped transformation for {target!r} — configuration must be an object")
            return None
        operation = str(raw.get("type") or "").strip().lower()
        if operation == "regex_extract":
            transform = _validate_regex_extract(target, raw, values, reject)
        elif operation == "value_map":
            transform = _validate_value_map(target, raw, values, source, reject)
        elif operation == "rules":
            transform = _validate_rules(target, raw, raw_columns, reject)
        elif operation == "uom_factor":
            transform = _validate_uom_factor(target, raw, raw_columns, reject)
        elif operation == "multiply":
            transform = _validate_multiply(target, raw, raw_columns, reject)
        elif operation == "month_start":
            transform = {"type": "month_start"}
            if raw.get("format"):
                transform["format"] = str(raw["format"])
        elif operation in ("negate", "forward_fill", "zero_as_empty"):
            transform = {"type": operation}
        else:
            transform = reject(f"Dropped transformation for {target!r} — unsupported type: {operation!r}")
        if transform is None:
            return None
        clean.append(transform)
    return clean


def _validate_labels(raw, key_target: str, label: str, warnings: list[str]) -> list[dict] | None:
    """A melt group's labels, cleaned: [] when it has none, None when unusable."""
    if not raw:
        return []
    if not isinstance(raw, list):
        warnings.append(f"Dropped melt group for {label!r} — labels must be a list")
        return None
    clean = []
    for item in raw:
        item = item if isinstance(item, dict) else {}
        rows_above, target = item.get("rows_above"), item.get("target")
        if not isinstance(rows_above, int) or isinstance(rows_above, bool) or rows_above < 0:
            warnings.append(f"Dropped melt group for {label!r} — a label's rows_above must be 0 (the header) or more")
            return None
        if target not in LABEL_TARGETS or target == key_target or any(c["target"] == target for c in clean):
            warnings.append(
                f"Dropped melt group for {label!r} — each label fills one descriptive field "
                f"({', '.join(LABEL_TARGETS)}) once, and not the field the key fills"
            )
            return None
        clean.append({"rows_above": rows_above, "target": target})
    return clean


def _group_fills(group: dict) -> tuple[str, ...]:
    """Every field one melt group fills: its key's, its values', its labels'."""
    labels = tuple(label["target"] for label in group.get("labels") or [])
    return (group["key"]["target"], group["value_target"], *labels)


def _validate_group(group, raw_columns, target_schema, trust_review, warnings):
    """One melt group, cleaned, with the columns it selects; None if unusable."""
    group_id = str(group.get("id") or "").strip()
    value_target = group.get("value_target")
    key = group.get("key") or {}
    key_target = key.get("target")
    label = group_id or value_target

    if not group_id:
        warnings.append(f"Dropped melt group for {label!r} — it has no id")
        return None
    if value_target not in target_schema or value_target not in MEASURE_FIELDS:
        warnings.append(f"Dropped melt group — target not in schema: {value_target!r}")
        return None
    if key_target not in MELT_KEY_TARGETS:
        warnings.append(f"Dropped melt group for {label!r} — key target must be one of {MELT_KEY_TARGETS}")
        return None

    try:
        columns = resolve_selector(group.get("select") or {}, raw_columns)
    except re.error as exc:
        warnings.append(f"Dropped melt group for {label!r} — bad regex: {exc}")
        return None
    except ValueError as exc:
        warnings.append(f"Dropped melt group for {label!r} — {exc}")
        return None
    if not columns:
        warnings.append(f"Dropped melt group for {label!r} — no columns listed")
        return None

    pattern = key.get("pattern")
    if pattern:
        try:
            compiled = re.compile(pattern)
        except re.error as exc:
            warnings.append(f"Dropped melt group for {label!r} — bad regex: {exc}")
            return None
        if compiled.groups < 1:
            warnings.append(f"Dropped melt group for {label!r} — regex has no capture group")
            return None
        unmatched = [column for column in columns if not compiled.search(column)]
        if unmatched:
            warnings.append(f"Dropped melt group for {label!r} — regex didn't match: {unmatched[:3]}")
            return None
        keys = [compiled.search(column).group(1) for column in columns]
    else:
        keys = list(columns)

    date_format = key.get("date_format")
    if key_target == "period_start":
        if not date_format:
            warnings.append(f"Dropped melt group for {label!r} — a period key needs a date_format")
            return None
        try:
            pd.to_datetime(pd.Series(keys), format=date_format, errors="raise")
        except Exception as exc:
            warnings.append(
                f"Dropped melt group for {label!r} — date_format {date_format!r} "
                f"failed on {keys[0]!r}: {exc}"
            )
            return None

    labels = _validate_labels(group.get("labels"), key_target, label, warnings)
    if labels is None:
        return None

    select = dict(group.get("select") or {})
    clean = {
        "id": group_id,
        "select": select,
        "key": {"target": key_target, **({"pattern": pattern} if pattern else {})},
        "value_target": value_target,
        **_clean_annotation(group, trust_review),
    }
    if labels:
        clean["labels"] = labels
    if date_format:
        clean["key"]["date_format"] = date_format
    period_type = str(group.get("period_type") or "").lower()
    if key_target == "period_start":
        if period_type not in PERIOD_TYPES:
            headers = [column.lower() for column in columns]
            period_type = (
                "week" if all("week" in h for h in headers)
                else "month" if all("month" in h for h in headers)
                else ""
            )
        if period_type:
            clean["period_type"] = period_type
    return clean, columns


def _fixed_entry(target: str) -> dict | None:
    """The entry a field gets whatever was proposed for it, or None if it is decidable."""
    if target in SYSTEM_FIELDS:
        return {"status": "system", "confidence": "high", "rationale": "The uploaded file's name."}
    if target in PERIOD_DERIVED_FIELDS:
        return {"status": "derived", "confidence": "high", "rationale": "Computed from the period."}
    return None


def _not_available(reason: str, annotation: dict | None = None, trust_review: bool = False) -> dict:
    return {
        "status": "not_available",
        "reason": reason,
        **_clean_annotation(annotation, trust_review, default="medium"),
    }


def validate_contract(
    contract: dict,
    raw_columns: list[str],
    target_schema: list[str] | None = None,
    trust_review: bool = False,
    samples: dict[str, list[str]] | None = None,
) -> dict:
    """
    Defensive checks before trusting a contract. Returns the contract with an
    entry for every target field, and a `warnings` list naming
    everything that was dropped or overridden and why.

    Nothing unsafe is applied silently: a mapping whose source column is not in
    the file, or whose transform does not hold on the file's own values,
    becomes "not_available" with the reason, which a reviewer sees, and which
    the required-field gate catches for the fields that matter.

    trust_review is True only on the confirm path, where the contract came from
    a reviewer; a freshly generated contract has every "reviewed" flag cleared.
    """
    target_schema = list(target_schema or BUSINESS_COLUMNS)
    proposed = read_contract(contract)
    warnings: list[str] = list(proposed.get("warnings") or [])
    samples = samples or {}
    raw_set = set(raw_columns)

    groups: dict[str, dict] = {}
    group_cols: dict[str, list[str]] = {}
    claimed_measures: dict[str, str] = {}
    for group in proposed.get("melt_groups") or []:
        result = _validate_group(group, raw_columns, target_schema, trust_review, warnings)
        if result is None:
            continue
        clean, columns = result
        if clean["id"] in groups:
            warnings.append(f"Dropped melt group {clean['id']!r} — the id is used twice")
            continue
        if clean["value_target"] in claimed_measures:
            warnings.append(
                f"Dropped melt group — {clean['value_target']!r} is already filled by "
                f"melt group {claimed_measures[clean['value_target']]!r}"
            )
            continue
        key_targets = {g["key"]["target"] for g in groups.values()}
        if key_targets and clean["key"]["target"] not in key_targets:
            warnings.append(
                f"Dropped melt group {clean['id']!r} — every melt group must share one key "
                f"({', '.join(sorted(key_targets))})"
            )
            continue
        groups[clean["id"]] = clean
        group_cols[clean["id"]] = columns
        claimed_measures[clean["value_target"]] = clean["id"]

    proposed_fields = proposed.get("fields") or {}
    for target in proposed_fields:
        if target not in target_schema:
            warnings.append(f"Dropped field mapping — target not in schema: {target!r}")

    fields: dict[str, dict] = {}
    for target in target_schema:
        raw = proposed_fields.get(target)
        fixed = _fixed_entry(target)
        if fixed:
            if isinstance(raw, dict) and raw.get("status") == "mapped" and raw.get("source"):
                warnings.append(f"{target!r} is not read from {raw['source']!r}: {fixed['rationale']}")
            fields[target] = fixed
            continue
        fields[target] = _validate_field(
            target, raw, raw_columns, raw_set, groups, group_cols, samples, trust_review, warnings
        )

    # A derived field reads another field; that other field must produce values.
    for target, entry in fields.items():
        source_field = entry.get("from_field")
        if entry["status"] == "derived" and source_field:
            if fields.get(source_field, {}).get("status") in ("not_available", "derived", None):
                warnings.append(
                    f"Dropped field mapping — {target!r} is derived from {source_field!r}, "
                    "which has no values"
                )
                fields[target] = _not_available(f"{source_field} is not available", entry, trust_review)

    # A stated period is read as the one calendar month it covers, so the rows
    # it dates must be monthly.
    period_start, period_type = fields.get("period_start") or {}, fields.get("period_type") or {}
    if period_start.get("from_layout") and (
        period_type.get("status") != "constant" or period_type.get("value") != "month"
    ):
        warnings.append(
            "Dropped field mapping — a period read from the file's stated period is a month, "
            "so period_type must be the constant 'month'"
        )
        fields["period_start"] = _not_available("The stated period needs period_type 'month'.", period_start, trust_review)

    # A melt group no field reads would melt for nothing.
    used = {entry.get("melt_group") for entry in fields.values()}
    for group_id in list(groups):
        if group_id not in used:
            warnings.append(f"Dropped melt group {group_id!r} — no field reads it")
            del groups[group_id]

    data_source = proposed.get("data_source")
    return {
        "layout": _validate_layout(proposed.get("layout"), raw_set, warnings),
        "fields": fields,
        "melt_groups": list(groups.values()),
        "aggregate": _validate_aggregate(proposed.get("aggregate"), warnings),
        "data_source": data_source if data_source in DATA_SOURCES else DEFAULT_DATA_SOURCE,
        "warnings": warnings,
    }


# ---- The layout and roll-up instructions ---------------------------------------------

def layout_instructions(layout: dict) -> dict:
    """
    Where the data sits in the file, as the contract records it: what layout
    detection found, written down so the transformation reads the same table
    (the sheet, the header row, the footer and subtotal rows to skip, the
    merged columns to fill down) instead of finding it again.
    """
    position = None
    if layout.get("sheet") is not None and layout.get("sheets"):
        position = layout["sheets"].index(layout["sheet"]) + 1
    return {
        "sheet": layout.get("sheet"),
        "sheet_position": position,
        "header_row": int(layout.get("header_row") or 1),
        "fill_down": list(layout.get("filled_columns") or []),
        "footer_label_pattern": FOOTER_LABEL_PATTERN,
        "subtotal_label_pattern": SUBTOTAL_LABEL_PATTERN,
    }


def _validate_layout(raw, raw_set: set[str], warnings: list[str]) -> dict | None:
    """The layout section, cleaned; None when the contract has none."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        warnings.append("Dropped layout — it must be an object")
        return None
    header_row = raw.get("header_row", 1)
    if not isinstance(header_row, int) or isinstance(header_row, bool) or header_row < 1:
        warnings.append("Layout header_row must be a row number; using row 1")
        header_row = 1
    fill_down = [column for column in raw.get("fill_down") or [] if column in raw_set]
    if len(fill_down) != len(raw.get("fill_down") or []):
        warnings.append("Dropped layout fill_down columns that are not in the file")
    clean = {
        "sheet": raw.get("sheet"),
        "sheet_position": raw.get("sheet_position"),
        "header_row": header_row,
        "fill_down": fill_down,
    }
    for key in ("footer_label_pattern", "subtotal_label_pattern"):
        pattern = raw.get(key)
        if pattern:
            try:
                re.compile(pattern)
                clean[key] = pattern
            except re.error:
                warnings.append(f"Dropped layout {key} — invalid regex")
    return clean


def _validate_aggregate(raw, warnings: list[str]) -> dict | None:
    """
    The roll-up instruction, cleaned: one row per AGGREGATE_KEY in each
    calendar month, measures summed. None means rows load at the file's grain.
    """
    if not raw:
        return None
    if not isinstance(raw, dict) or raw.get("period") not in AGGREGATE_PERIODS:
        warnings.append(f"Dropped aggregate — period must be one of {AGGREGATE_PERIODS}")
        return None
    return monthly_aggregate()


def monthly_aggregate() -> dict:
    """The roll-up instruction for business rule B1: calendar months."""
    return {"period": "month", "by": list(AGGREGATE_KEY), "sum": list(MEASURE_FIELDS)}


def _validate_field(target, raw, raw_columns, raw_set, groups, group_cols, samples, trust_review, warnings):
    """One decidable field's entry, cleaned; not_available with a reason when unusable."""
    if not isinstance(raw, dict):
        return _not_available("No decision was made for this field.", None, trust_review)

    status = str(raw.get("status") or "").strip().lower()
    annotation = _clean_annotation(raw, trust_review)
    transforms_raw = raw.get("transforms")

    if status == "not_available":
        reason = str(raw.get("reason") or "").strip() or "Not in this file."
        return _not_available(reason, raw, trust_review)

    if status == "constant":
        value = str(raw.get("value") if raw.get("value") is not None else "").strip()
        if not value:
            warnings.append(f"Dropped field mapping — {target!r} is constant but has no value")
            return _not_available("A constant needs a value.", raw, trust_review)
        if target == "period_type" and value not in PERIOD_TYPES:
            warnings.append(f"Dropped field mapping — period_type must be one of {PERIOD_TYPES}")
            return _not_available("Unknown period type.", raw, trust_review)
        return {"status": "constant", "value": value, **annotation}

    if status == "derived":
        if target == "period_type":
            period_groups = [g for g in groups.values() if g["key"]["target"] == "period_start"]
            if not period_groups or not all(g.get("period_type") for g in period_groups):
                warnings.append(
                    "Dropped field mapping — period_type can only be read from period column "
                    "headers that say month or week"
                )
                return _not_available("No period columns to read the period type from.", raw, trust_review)
            return {"status": "derived", **annotation}
        if raw.get("from_layout"):
            if target != "period_start" or raw["from_layout"] not in LAYOUT_SOURCES:
                warnings.append(
                    f"Dropped field mapping — only period_start can be read from the file's "
                    f"stated period, not {target!r} from {raw['from_layout']!r}"
                )
                return _not_available("Only the period can be read from the file's title.", raw, trust_review)
            return {"status": "derived", "from_layout": raw["from_layout"], **annotation}
        source_field = raw.get("from_field")
        if source_field not in BUSINESS_COLUMNS or source_field == target:
            warnings.append(f"Dropped field mapping — {target!r} is derived from an unknown field {source_field!r}")
            return _not_available("Derived from an unknown field.", raw, trust_review)
        transforms = validate_transforms(target, transforms_raw, raw_columns, [], None, warnings)
        if transforms is None:
            return _not_available("Its transform was rejected.", raw, trust_review)
        entry = {"status": "derived", "from_field": source_field, **annotation}
        if transforms:
            entry["transforms"] = transforms
        return entry

    if status == "mapped":
        source = raw.get("source")
        group_id = raw.get("melt_group")
        if group_id:
            group = groups.get(group_id)
            if group is None:
                warnings.append(f"Dropped field mapping — {target!r} reads melt group {group_id!r}, which was dropped")
                return _not_available("Its melt group was dropped.", raw, trust_review)
            if target not in _group_fills(group):
                warnings.append(
                    f"Dropped field mapping — melt group {group_id!r} fills "
                    f"{', '.join(_group_fills(group))}, not {target!r}"
                )
                return _not_available("Its melt group fills other fields.", raw, trust_review)
            transforms = validate_transforms(target, transforms_raw, raw_columns, [], None, warnings)
            if transforms is None:
                return _not_available("Its transform was rejected.", raw, trust_review)
            entry = {"status": "mapped", "melt_group": group_id, **annotation}
            if transforms:
                entry["transforms"] = transforms
            return entry

        if source not in raw_set:
            warnings.append(f"Dropped field mapping — source column not found: {source!r}")
            return _not_available("Its source column is not in the file.", raw, trust_review)
        if any(source in columns for columns in group_cols.values()):
            warnings.append(f"Dropped field mapping — {source!r} is melted by a melt group")
            return _not_available("Its source column is melted.", raw, trust_review)
        transforms = validate_transforms(
            target, transforms_raw, raw_columns, samples.get(source, []), source, warnings
        )
        if transforms is None:
            return _not_available("Its transform was rejected.", raw, trust_review)
        entry = {"status": "mapped", "source": source, **annotation}
        if transforms:
            entry["transforms"] = transforms
        return entry

    warnings.append(f"Dropped field mapping — {target!r} has an unknown status {status!r}")
    return _not_available("Unknown status.", raw, trust_review)


# ---- Questions asked of a validated contract ---------------------------------------

def required_missing_fields(contract: dict) -> list[str]:
    """Required fields a contract cannot produce."""
    fields = read_contract(contract).get("fields") or {}
    return [
        field
        for field in REQUIRED_FIELDS
        if (fields.get(field) or {}).get("status", "not_available") == "not_available"
    ]


def unreviewed_low_confidence(contract: dict) -> list[str]:
    """
    Fields and melt groups the proposal was unsure of that no reviewer has
    confirmed. The review screen will not approve while any exist, but that is
    the browser's word; this lets the confirm endpoint hold the same line.
    """
    current = read_contract(contract)
    fields = [
        target
        for target, entry in (current.get("fields") or {}).items()
        if entry.get("confidence") == "low" and not entry.get("reviewed")
    ]
    groups = [
        group.get("value_target") or group.get("id")
        for group in current.get("melt_groups") or []
        if group.get("confidence") == "low" and not group.get("reviewed")
    ]
    return list(dict.fromkeys(fields + groups))


def _heading_values(contract: dict, entry: dict, target: str, columns: list[str], layout: dict | None) -> list[str] | None:
    """
    What a field read from a melt group's headings -- or the cells above them
    -- is filled with, or None when that cannot be told without the file.
    """
    group = next((g for g in contract.get("melt_groups") or [] if g.get("id") == entry.get("melt_group")), None)
    if group is None:
        return None
    try:
        selected = resolve_selector(group.get("select") or {}, columns)
    except (ValueError, re.error):
        return None
    label = next((item for item in group.get("labels") or [] if item.get("target") == target), None)
    if (group.get("key") or {}).get("target") == target or (label and label.get("rows_above") == 0):
        return selected
    if label is None or layout is None:
        return None
    row = int(layout.get("header_row") or 1) - label["rows_above"]
    cells = next((item["cells"] for item in layout.get("rows_above_header") or [] if item.get("row") == row), {})
    return [cells[column] for column in selected if column in cells]


def retailer_outputs(
    contract: dict,
    samples: dict[str, list] | None = None,
    columns: list[str] | None = None,
    layout: dict | None = None,
) -> list[str] | None:
    """
    Every retailer name a contract writes sales to, read from its instructions
    without running them: a constant's value, or the outputs (and default) of
    the rules or code table that last translates the retailer. A column read
    as it is writes the column's own values, taken from `samples` when given;
    a group's headings read as they are write the headings, or the cells over
    them, taken from the file's `columns` and `layout` when given.

    None when that cannot be known from the contract alone, so a caller can
    tell "writes to nothing" from "cannot say".

    Uploads create any retailer name they meet (catalog_service
    get_or_create_retailers) with no customer, which the dashboard then never
    finds, so approval checks these against the mapping's customer first.
    """
    contract = read_contract(contract)
    entry = (contract.get("fields") or {}).get("retailer") or {}
    status = entry.get("status")
    if status == "constant":
        return [str(entry.get("value"))] if entry.get("value") not in (None, "") else []
    if status not in ("mapped", "derived"):
        return []

    transforms = entry.get("transforms") or []
    last = transforms[-1] if transforms else None
    if last and last.get("type") == "rules":
        outputs = [rule.get("output") for rule in last.get("rules") or []]
    elif last and last.get("type") == "value_map":
        outputs = list((last.get("values") or {}).values())
    elif not transforms and samples and entry.get("source") in samples:
        outputs = list(samples[entry["source"]] or [])
    elif not transforms and entry.get("melt_group") and columns is not None:
        outputs = _heading_values(contract, entry, "retailer", columns, layout)
        if outputs is None:
            return None
    else:
        return None

    if last and last.get("default") not in (None, ""):
        outputs.append(last["default"])
    return list(dict.fromkeys(str(output) for output in outputs if output not in (None, "")))


DECISION_KEYS = ("status", "source", "melt_group", "from_field", "from_layout", "value", "transforms")


def contract_diff(before: dict | None, after: dict) -> list[dict]:
    """
    What a reviewer changed between the proposal and the approved contract,
    one entry per field or melt group that differs. Kept on the confirmed
    mapping so prompts can be improved from what people actually corrected.
    """
    old, new = read_contract(before), read_contract(after)
    changes = []
    old_fields, new_fields = old.get("fields") or {}, new.get("fields") or {}
    for target in dict.fromkeys([*old_fields, *new_fields]):
        a = {key: (old_fields.get(target) or {}).get(key) for key in DECISION_KEYS}
        b = {key: (new_fields.get(target) or {}).get(key) for key in DECISION_KEYS}
        if a != b:
            changes.append({
                "field": target,
                "before": {k: v for k, v in a.items() if v is not None},
                "after": {k: v for k, v in b.items() if v is not None},
            })

    group_keys = ("select", "key", "labels", "value_target", "period_type")
    old_groups = {g.get("id"): g for g in old.get("melt_groups") or []}
    new_groups = {g.get("id"): g for g in new.get("melt_groups") or []}
    for group_id in dict.fromkeys([*old_groups, *new_groups]):
        a = {k: (old_groups.get(group_id) or {}).get(k) for k in group_keys}
        b = {k: (new_groups.get(group_id) or {}).get(k) for k in group_keys}
        if a != b:
            changes.append({"melt_group": group_id, "before": a, "after": b})
    return changes
