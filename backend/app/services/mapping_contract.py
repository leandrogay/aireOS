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
      "filters": [{"column": "Txn Type", "op": "equals", "value": "TRANSFER", "action": "drop"}],
      "aggregate": {"period": "month", "by": [...], "sum": ["quantity_units", "revenue"]},
      "unsupported": [{"field": "revenue", "issue": "Sales are in two currencies."}]
    }

`filters` say which of the file's rows are sales at all: each drops the rows
it matches, or keeps only those, before anything else is read. `unsupported`
is where a proposal says what the file needs that no instruction can do, so
the gap is put in front of a reviewer instead of papered over.

Statuses:
  mapped         read from a source column, or from a melt group's key or value
  derived        computed: period_end / period_label from the period, period_type
                 from the melt headers, another field run through transforms
                 (`from_field`, e.g. retailer from the outlet code's _Ecomm suffix,
                 revenue as quantity times a per-unit price column), or the
                 period the file states above its table (`from_layout`:
                 "stated_period", SingHealth's "DATE : 01 Aug 2026 TO 31 Aug 2026";
                 "filename_period", the one month the file's name states, for a
                 file that carries no date at all -- "Prime - Jan 2026 - ..."),
                 or one cell of the sheet written on every row (`from_cell`:
                 "A1", where Pharmex writes its month "Jul-26"); each month's
                 file is read at the same cell, so it is dated by itself
  constant       the same `value` on every row (NHG's retailer)
  system         written by the pipeline (source_file)
  not_available  the file does not hold it; `reason` says why. Never invented.

A melt group's key is what each melted column's header says (a period, a store
code or a store name). Its `labels` read more of it: {"rows_above": 1,
"target": "store_code"} fills store_code from the cell directly above each
melted column, where SingHealth writes the outlet's code over its name, and
{"rows_above": 0, "target": "store_name"} reads the header itself again, so one
heading can fill both the store code and the store name. {"rows_below": 1,
"target": "store_code"} reads the cell directly under each melted column's
header instead, for a file that writes the outlet's code under its name; that
row is a heading, so it is never read as data (table_rows).

The sku field's value_map is the product-code table: each retailer code in the
file and the master SKU it is. A field with no value_map uses the file's codes
as they are (FairPrice article numbers are the master codes).

Pure: no GCS, no database, no model.
"""

import copy
import re

import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import value_parsing
from app.services.column_profile import header_template, month_year

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
LAYOUT_SOURCES = ("stated_period", "filename_period")
# What one cell of the sheet may fill on every row: the period, or any
# descriptive field (an outlet written once at the top, say). A figure is
# never one cell repeated.
CELL_TARGETS = ("period_start", *HEADING_FIELDS)
# A cell named the way a spreadsheet names it: "A1", "AB12".
CELL_REFERENCE = re.compile(r"^[A-Z]{1,3}[1-9]\d*$")
PERIOD_TYPES = ("month", "week")
SELECTOR_KINDS = ("pattern", "between", "columns")

# The roll-up instruction's grain: one row per these fields, measures summed.
AGGREGATE_KEY = ("period_start", "period_type", "retailer", "store_code", "sku")
AGGREGATE_PERIODS = ("month",)

# How layout detection marks footer and subtotal rows, recorded in the
# contract's layout so the transformation skips the same rows.
FOOTER_LABEL_PATTERN = r"^(grand\s+)?total\b"
SUBTOTAL_LABEL_PATTERN = r"^(grand\s+|sub\s*)?total$"

# The transformation's whole vocabulary (apply_contract runs each; the
# prompt, docs/mapping-transformations.md and the review screen's
# transformSteps.js describe each). Grouped by what a step is for.
TEXT_TRANSFORMS = ("regex_extract", "split_part", "replace", "normalize_text", "concat")
LOOKUP_TRANSFORMS = ("value_map", "rules")
EMPTY_TRANSFORMS = ("blank_if", "fill_empty", "forward_fill", "zero_as_empty")
NUMBER_TRANSFORMS = ("parse_number", "negate", "scale", "uom_factor", "multiply", "divide", "add", "subtract")
DATE_TRANSFORMS = ("parse_date", "month_start")
TRANSFORM_TYPES = (
    *TEXT_TRANSFORMS, *LOOKUP_TRANSFORMS, *EMPTY_TRANSFORMS, *NUMBER_TRANSFORMS, *DATE_TRANSFORMS,
)
# Steps that work a figure out with the same row's value in another column.
ARITHMETIC_TRANSFORMS = ("multiply", "divide", "add", "subtract")
TEXT_CASES = ("upper", "lower", "title", "keep")
RULE_OPS = ("equals", "startswith", "endswith", "contains", "regex")
# A row filter tests one column the way a rule does, or for an empty cell.
FILTER_OPS = (*RULE_OPS, "empty")
FILTER_ACTIONS = ("drop", "keep")


# ---- Matching a value against a rule ------------------------------------------------

def rule_matches(text: str, op: str, expected: str, case_sensitive: bool = False) -> bool:
    """Whether a value meets one condition of a rules transform or a row filter (RULE_OPS)."""
    if op == "regex":
        return re.search(expected, text, 0 if case_sensitive else re.IGNORECASE) is not None
    if not case_sensitive:
        text, expected = text.casefold(), expected.casefold()
    if op == "equals":
        return text == expected
    if op == "startswith":
        return text.startswith(expected)
    if op == "endswith":
        return text.endswith(expected)
    return op == "contains" and expected in text


def rows_matching(frame: pd.DataFrame, row_filter: dict) -> pd.Series:
    """
    Which of the file's rows a row filter matches: the ones it drops, or the
    only ones it keeps. An empty cell matches "empty" and nothing else.
    Raises ValueError when the filter's column is not in the file.
    """
    column = row_filter["column"]
    if column not in frame:
        raise ValueError(f"row filter column {column!r} is not in the file")
    blank = value_parsing.is_blank(frame[column])
    if row_filter["op"] == "empty":
        return blank
    case_sensitive = row_filter.get("case_sensitive", False)
    matched = frame[column].map(
        lambda value: not pd.isna(value)
        and rule_matches(str(value).strip(), row_filter["op"], row_filter["value"], case_sensitive)
    )
    return matched.astype(bool) & ~blank


def filtered_rows(frame: pd.DataFrame, contract: dict) -> pd.DataFrame:
    """The file's rows the contract's filters leave, each filter applied in turn."""
    for row_filter in (contract or {}).get("filters") or []:
        matched = rows_matching(frame, row_filter)
        frame = frame[~matched if row_filter["action"] == "drop" else matched]
    return frame.reset_index(drop=True)


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


def with_file_columns(contract: dict | None, columns: list[str]) -> dict:
    """
    A copy of a contract whose column names are this file's.

    A file is matched to a contract by its headings with their months and
    numbers set aside (column_profile.fingerprint), so next month's file may
    head a column "Jul-26" where the contract, made from August's, names
    "Aug-26". Each column the contract names that the file lacks becomes the
    file's one column whose heading reads the same once its month and numbers
    are set aside (header_template). A name with no such column, or with
    several, is left as it is and fails where it is read, as before.
    """
    contract = read_contract(contract)
    present = set(columns)
    by_template: dict[str, list[str]] = {}
    for column in columns:
        by_template.setdefault(header_template(column), []).append(column)

    def renamed(name):
        if not isinstance(name, str) or name in present:
            return name
        matches = by_template.get(header_template(name)) or []
        return matches[0] if len(matches) == 1 else name

    for entry in contract["fields"].values():
        if entry.get("source"):
            entry["source"] = renamed(entry["source"])
        for transform in entry.get("transforms") or []:
            if transform.get("column"):
                transform["column"] = renamed(transform["column"])
            if transform.get("columns"):
                transform["columns"] = [renamed(column) for column in transform["columns"]]
            for factor in (transform.get("factors") or {}).values():
                if isinstance(factor, dict) and factor.get("column"):
                    factor["column"] = renamed(factor["column"])
    for group in contract["melt_groups"]:
        select = group.get("select") or {}
        for marker in ("after", "before"):
            if select.get(marker):
                select[marker] = renamed(select[marker])
        if select.get("columns"):
            select["columns"] = [renamed(column) for column in select["columns"]]
    for row_filter in contract.get("filters") or []:
        if isinstance(row_filter, dict) and row_filter.get("column"):
            row_filter["column"] = renamed(row_filter["column"])
    layout = contract.get("layout")
    if isinstance(layout, dict) and layout.get("fill_down"):
        layout["fill_down"] = [renamed(column) for column in layout["fill_down"]]
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


# ---- The rows a melt group's labels read ----------------------------------------------

def reads_headings(label: dict) -> bool:
    """Whether a label reads the headings themselves again (rows_above 0) rather than another row."""
    return label.get("rows_below") is None and label.get("rows_above") == 0


def label_row(label: dict, layout: dict | None) -> int:
    """The file row a label reads: counted up from the header row, or down with rows_below."""
    header_row = int((layout or {}).get("header_row") or 1)
    if label.get("rows_below") is not None:
        return header_row + label["rows_below"]
    return header_row - label["rows_above"]


def label_cells(label: dict, layout: dict | None) -> dict[str, str]:
    """
    The cells of the row a label reads, keyed by the header each sits under
    (layout_detection rows_above_header / rows_below_header); {} when the
    file has nothing on that row.
    """
    key = "rows_below_header" if label.get("rows_below") is not None else "rows_above_header"
    row = label_row(label, layout)
    return next((item["cells"] for item in (layout or {}).get(key) or [] if item.get("row") == row), {})


def table_rows(frame: pd.DataFrame, contract: dict, layout: dict | None) -> pd.DataFrame:
    """
    The file's data rows without the rows of headings under its header that
    the contract reads labels from: outlet codes under the outlet names are
    headings, not sales. Layout detection keeps such a row in the table when
    nothing else marks it (layout_detection _rows_below_header, `in_table`),
    always at the top. Rows are matched by their cells, so a table they were
    already taken out of comes back as it is.
    """
    deepest = max(
        (
            label["rows_below"]
            for group in (contract or {}).get("melt_groups") or []
            for label in group.get("labels") or []
            if label.get("rows_below") is not None
        ),
        default=0,
    )
    if not deepest:
        return frame
    # Every row from the header down to the deepest one read is a heading.
    last = int((layout or {}).get("header_row") or 1) + deepest
    headings = [
        item["cells"]
        for item in (layout or {}).get("rows_below_header") or []
        if item["row"] <= last and item.get("in_table")
    ]
    if not headings:
        return frame
    top = frame.head(len(headings))
    taken = [
        index
        for index, record in zip(top.index, top.to_dict(orient="records"))
        if {column: value for column, value in record.items() if value is not None} in headings
    ]
    return frame.drop(index=taken).reset_index(drop=True)


# ---- One cell written on every row --------------------------------------------------

def clean_cell_reference(value) -> str | None:
    """A cell reference as the contract stores it ("a1", "$A$1" -> "A1"), or None when it is not one."""
    text = str(value if value is not None else "").strip().upper().replace("$", "")
    return text if CELL_REFERENCE.match(text) else None


def cell_value(layout: dict | None, reference: str) -> str | None:
    """
    The text in one cell at the top of the sheet (layout_detection `cells`),
    or None when the cell is empty or lies below the rows that are kept.
    """
    return ((layout or {}).get("cells") or {}).get(reference)


def cell_period(text) -> pd.Timestamp | None:
    """
    The date a cell's value names, or None: a month and year ("Jul-26",
    "August 2026") is its first day, else a date as Excel or a person writes
    it ("2026-07-01", "01/07/2026").
    """
    if text is None or not str(text).strip():
        return None
    month = month_year(text)
    if month is not None:
        return month
    parsed = pd.to_datetime(str(text).strip(), format="ISO8601", errors="coerce")
    if pd.isna(parsed):
        parsed = pd.to_datetime(str(text).strip(), dayfirst=True, errors="coerce")
    return None if pd.isna(parsed) else parsed.normalize()


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
        # Negative for the rows a type column marks as returns.
        elif _is_number(factor) and factor != 0:
            factors[str(uom).strip()] = factor
        else:
            return reject(
                f"Dropped transformation for {target!r} — factor for {uom!r} must be a "
                "number other than 0 or a column of the file"
            )
    default = raw.get("default", 1)
    if not isinstance(default, (int, float)) or isinstance(default, bool) or default <= 0:
        default = 1
    return {"type": "uom_factor", "column": column, "factors": factors, "default": default}


def _validate_arithmetic(target, operation, raw, raw_columns, reject):
    """Each value worked out with the same row's value in another column (units x price)."""
    column = raw.get("column")
    if column not in raw_columns:
        return reject(f"Dropped transformation for {target!r} — {operation} column {column!r} is not in the file")
    return {"type": operation, "column": column}


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_parse_number(target, raw, reject):
    decimal = raw.get("decimal") or "."
    if decimal not in value_parsing.DECIMAL_MARKS:
        return reject(f"Dropped transformation for {target!r} — parse_number decimal must be '.' or ','")
    return {"type": "parse_number", "decimal": decimal}


def _validate_scale(target, raw, reject):
    factor = raw.get("factor")
    if not _is_number(factor) or factor == 0:
        return reject(f"Dropped transformation for {target!r} — scale needs a factor other than 0")
    return {"type": "scale", "factor": factor}


def _validate_date_step(target, operation, raw, reject):
    """parse_date or month_start: an optional strptime format that must at least be usable."""
    date_format = str(raw.get("format") or "").strip()
    if not date_format:
        return {"type": operation}
    if date_format != value_parsing.EXCEL_SERIAL and "%" not in date_format:
        return reject(
            f"Dropped transformation for {target!r} — {operation} format {date_format!r} is not a "
            f"strptime format such as '%d/%m/%Y', nor {value_parsing.EXCEL_SERIAL!r}"
        )
    return {"type": operation, "format": date_format}


def _validate_replace(target, raw, reject):
    pattern = raw.get("pattern")
    try:
        re.compile(pattern or "")
    except (re.error, TypeError) as exc:
        return reject(f"Dropped transformation for {target!r} — invalid regex: {exc}")
    if not pattern:
        return reject(f"Dropped transformation for {target!r} — replace needs a pattern")
    replacement = str(raw.get("replacement") if raw.get("replacement") is not None else "")
    try:
        re.sub(pattern, replacement, "")
    except (re.error, IndexError) as exc:
        return reject(f"Dropped transformation for {target!r} — invalid replacement: {exc}")
    return {"type": "replace", "pattern": pattern, "replacement": replacement}


def _validate_normalize_text(target, raw, reject):
    case = str(raw.get("case") or "keep").strip().lower()
    if case not in TEXT_CASES:
        return reject(f"Dropped transformation for {target!r} — case must be one of {', '.join(TEXT_CASES)}")
    return {"type": "normalize_text", "case": case}


def _validate_blank_if(target, raw, reject):
    tokens = raw.get("tokens")
    tokens = [str(token).strip() for token in tokens if str(token).strip()] if isinstance(tokens, list) else []
    if not tokens:
        return reject(f"Dropped transformation for {target!r} — blank_if needs at least one token")
    return {"type": "blank_if", "tokens": list(dict.fromkeys(tokens))}


def _validate_fill_empty(target, raw, raw_columns, reject):
    column = raw.get("column")
    default = str(raw.get("default") if raw.get("default") is not None else "").strip()
    if column:
        if column not in raw_columns:
            return reject(f"Dropped transformation for {target!r} — fill_empty column {column!r} is not in the file")
        return {"type": "fill_empty", "column": column}
    if not default:
        return reject(f"Dropped transformation for {target!r} — fill_empty needs a default or a column")
    return {"type": "fill_empty", "default": default}


def _validate_concat(target, raw, raw_columns, reject):
    columns = raw.get("columns")
    if not isinstance(columns, list) or not columns:
        return reject(f"Dropped transformation for {target!r} — concat needs at least one column")
    missing = [column for column in columns if column not in raw_columns]
    if missing:
        return reject(f"Dropped transformation for {target!r} — concat columns not in the file: {missing[:3]}")
    separator = raw.get("separator")
    return {"type": "concat", "columns": list(columns), "separator": separator if isinstance(separator, str) else " "}


def _validate_split_part(target, raw, reject):
    separator, index = raw.get("separator"), raw.get("index")
    if not isinstance(separator, str) or separator == "":
        return reject(f"Dropped transformation for {target!r} — split_part needs a separator")
    if not _whole_number(index) or index == 0:
        return reject(
            f"Dropped transformation for {target!r} — split_part index counts parts from 1, "
            "or from the end with -1; it is never 0"
        )
    return {"type": "split_part", "separator": separator, "index": index}


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
        elif operation in ARITHMETIC_TRANSFORMS:
            transform = _validate_arithmetic(target, operation, raw, raw_columns, reject)
        elif operation in DATE_TRANSFORMS:
            transform = _validate_date_step(target, operation, raw, reject)
        elif operation == "parse_number":
            transform = _validate_parse_number(target, raw, reject)
        elif operation == "scale":
            transform = _validate_scale(target, raw, reject)
        elif operation == "replace":
            transform = _validate_replace(target, raw, reject)
        elif operation == "normalize_text":
            transform = _validate_normalize_text(target, raw, reject)
        elif operation == "blank_if":
            transform = _validate_blank_if(target, raw, reject)
        elif operation == "fill_empty":
            transform = _validate_fill_empty(target, raw, raw_columns, reject)
        elif operation == "concat":
            transform = _validate_concat(target, raw, raw_columns, reject)
        elif operation == "split_part":
            transform = _validate_split_part(target, raw, reject)
        elif operation in ("negate", "forward_fill", "zero_as_empty"):
            transform = {"type": operation}
        else:
            transform = reject(f"Dropped transformation for {target!r} — unsupported type: {operation!r}")
        if transform is None:
            return None
        clean.append(transform)
        # The samples are the column as the file has it. Once a step has
        # changed the values, a later step no longer meets them.
        if operation != "forward_fill":
            values = []
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
        rows_above, rows_below, target = item.get("rows_above"), item.get("rows_below"), item.get("target")
        if rows_below is not None:
            if rows_above is not None or not _whole_number(rows_below) or rows_below < 1:
                warnings.append(
                    f"Dropped melt group for {label!r} — a label reads rows_above or rows_below, "
                    "not both, and rows_below must be 1 or more"
                )
                return None
            position = {"rows_below": rows_below}
        elif not _whole_number(rows_above) or rows_above < 0:
            warnings.append(f"Dropped melt group for {label!r} — a label's rows_above must be 0 (the header) or more")
            return None
        else:
            position = {"rows_above": rows_above}
        if target not in LABEL_TARGETS or target == key_target or any(c["target"] == target for c in clean):
            warnings.append(
                f"Dropped melt group for {label!r} — each label fills one descriptive field "
                f"({', '.join(LABEL_TARGETS)}) once, and not the field the key fills"
            )
            return None
        clean.append({**position, "target": target})
    return clean


def _whole_number(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


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
            pd.to_datetime(pd.Series(keys).map(value_parsing.month_names), format=date_format, errors="raise")
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


def _has_values(entry: dict) -> bool:
    """
    Whether a field gives another field values to be worked out from: not one
    that is missing, nor one itself worked out from a field, which would chain.
    A field read from the title or a cell is derived but has its value.
    """
    status = entry.get("status")
    if status == "derived":
        return bool(entry.get("from_cell") or entry.get("from_layout"))
    return status not in ("not_available", None)


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
    # Next month's file names its month heading differently; it is still the column meant.
    proposed = with_file_columns(contract, raw_columns)
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
            warnings.append(f"Dropped field nomenclature — target not in schema: {target!r}")

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
            if not _has_values(fields.get(source_field) or {}):
                warnings.append(
                    f"Dropped field nomenclature — {target!r} is derived from {source_field!r}, "
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
            "Dropped field nomenclature — a period read from the file's title or name is a month, "
            "so period_type must be the constant 'month'"
        )
        fields["period_start"] = _not_available("The stated period needs period_type 'month'.", period_start, trust_review)

    # A melt group no field reads would melt for nothing.
    used = {entry.get("melt_group") for entry in fields.values()}
    for group_id in list(groups):
        if group_id not in used:
            warnings.append(f"Dropped melt group {group_id!r} — no field reads it")
            del groups[group_id]

    return {
        "layout": _validate_layout(proposed.get("layout"), raw_set, warnings),
        "fields": fields,
        "melt_groups": list(groups.values()),
        "filters": _validate_filters(proposed.get("filters"), warnings),
        "aggregate": _validate_aggregate(proposed.get("aggregate"), warnings),
        "unsupported": _validate_unsupported(proposed.get("unsupported"), target_schema),
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
        "stacked_sheets": bool(layout.get("stacked_sheets")),
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
        "stacked_sheets": bool(raw.get("stacked_sheets")),
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


def _validate_filters(raw, warnings: list[str]) -> list[dict]:
    """
    The row filters, cleaned. One that is not a filter at all is dropped with
    a warning; one naming a column this file lacks is kept, so the checks and
    the transformation fail on it rather than load rows it was written to
    leave out.
    """
    clean = []
    for item in raw if isinstance(raw, list) else []:
        item = item if isinstance(item, dict) else {}
        column = item.get("column")
        op = str(item.get("op") or "").strip().lower()
        action = str(item.get("action") or "").strip().lower()
        value = str(item.get("value") if item.get("value") is not None else "").strip()
        problem = None
        if not isinstance(column, str) or not column or op not in FILTER_OPS or action not in FILTER_ACTIONS:
            problem = (
                f"needs a column, an op ({', '.join(FILTER_OPS)}) and an action ({' or '.join(FILTER_ACTIONS)})"
            )
        elif op != "empty" and not value:
            problem = "needs a value to test for"
        elif op == "regex":
            try:
                re.compile(value)
            except re.error as exc:
                problem = f"has an invalid regex: {exc}"
        if problem:
            warnings.append(f"Dropped row filter on {column!r} — it {problem}")
            continue
        entry = {"column": column, "op": op, "action": action, "case_sensitive": bool(item.get("case_sensitive", False))}
        if op != "empty":
            entry["value"] = value
        clean.append(entry)
    return clean


def _validate_unsupported(raw, target_schema: list[str]) -> list[dict]:
    """What a proposal said it could not do, cleaned: the field it concerns (if one) and the issue."""
    clean = []
    for item in raw if isinstance(raw, list) else []:
        item = item if isinstance(item, dict) else {}
        issue = str(item.get("issue") or "").strip()
        if issue:
            field = item.get("field")
            clean.append({"field": field if field in target_schema else None, "issue": issue})
    return clean


def monthly_aggregate() -> dict:
    """The roll-up instruction for business rule B1: calendar months."""
    return {"period": "month", "by": list(AGGREGATE_KEY), "sum": list(MEASURE_FIELDS)}


def _validate_cell_field(target, raw, raw_columns, annotation, trust_review, warnings):
    """A field read from one cell and written on every row, cleaned; not_available when unusable."""
    reference = clean_cell_reference(raw["from_cell"])
    if target not in CELL_TARGETS:
        warnings.append(
            f"Dropped field nomenclature — {target!r} cannot be read from one cell: only the period "
            f"or a descriptive field ({', '.join(CELL_TARGETS[1:])}) is the same on every row"
        )
        return _not_available("This field cannot be read from one cell.", raw, trust_review)
    if reference is None:
        warnings.append(
            f"Dropped field nomenclature — {target!r} reads cell {raw['from_cell']!r}, "
            "which is not a cell like 'A1'"
        )
        return _not_available("Its cell is not a cell like A1.", raw, trust_review)
    transforms = validate_transforms(target, raw.get("transforms"), raw_columns, [], None, warnings)
    if transforms is None:
        return _not_available("Its transform was rejected.", raw, trust_review)
    entry = {"status": "derived", "from_cell": reference, **annotation}
    if transforms:
        entry["transforms"] = transforms
    return entry


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
            warnings.append(f"Dropped field nomenclature — {target!r} is constant but has no value")
            return _not_available("A constant needs a value.", raw, trust_review)
        if target == "period_type" and value not in PERIOD_TYPES:
            warnings.append(f"Dropped field nomenclature — period_type must be one of {PERIOD_TYPES}")
            return _not_available("Unknown period type.", raw, trust_review)
        return {"status": "constant", "value": value, **annotation}

    if status == "derived":
        if target == "period_type":
            period_groups = [g for g in groups.values() if g["key"]["target"] == "period_start"]
            if not period_groups or not all(g.get("period_type") for g in period_groups):
                warnings.append(
                    "Dropped field nomenclature — period_type can only be read from period column "
                    "headers that say month or week"
                )
                return _not_available("No period columns to read the period type from.", raw, trust_review)
            return {"status": "derived", **annotation}
        if raw.get("from_cell") is not None:
            return _validate_cell_field(target, raw, raw_columns, annotation, trust_review, warnings)
        if raw.get("from_layout"):
            if target != "period_start" or raw["from_layout"] not in LAYOUT_SOURCES:
                warnings.append(
                    f"Dropped field nomenclature — only period_start can be read from the period the file "
                    f"states ({', '.join(LAYOUT_SOURCES)}), not {target!r} from {raw['from_layout']!r}"
                )
                return _not_available("Only the period can be read from the file's title or name.", raw, trust_review)
            return {"status": "derived", "from_layout": raw["from_layout"], **annotation}
        source_field = raw.get("from_field")
        if source_field not in BUSINESS_COLUMNS or source_field == target:
            warnings.append(f"Dropped field nomenclature — {target!r} is derived from an unknown field {source_field!r}")
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
                warnings.append(f"Dropped field nomenclature — {target!r} reads melt group {group_id!r}, which was dropped")
                return _not_available("Its melt group was dropped.", raw, trust_review)
            if target not in _group_fills(group):
                warnings.append(
                    f"Dropped field nomenclature — melt group {group_id!r} fills "
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
            warnings.append(f"Dropped field nomenclature — source column not found: {source!r}")
            return _not_available("Its source column is not in the file.", raw, trust_review)
        if any(source in columns for columns in group_cols.values()):
            warnings.append(f"Dropped field nomenclature — {source!r} is melted by a melt group")
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

    warnings.append(f"Dropped field nomenclature — {target!r} has an unknown status {status!r}")
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
    What a field read from a melt group's headings -- or the cells above or
    below them -- is filled with, or None when that cannot be told without
    the file.
    """
    group = next((g for g in contract.get("melt_groups") or [] if g.get("id") == entry.get("melt_group")), None)
    if group is None:
        return None
    try:
        selected = resolve_selector(group.get("select") or {}, columns)
    except (ValueError, re.error):
        return None
    label = next((item for item in group.get("labels") or [] if item.get("target") == target), None)
    if (group.get("key") or {}).get("target") == target or (label and reads_headings(label)):
        return selected
    if label is None or layout is None:
        return None
    cells = label_cells(label, layout)
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


DECISION_KEYS = ("status", "source", "melt_group", "from_field", "from_layout", "from_cell", "value", "transforms")


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
