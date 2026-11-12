"""
Is a contract right? Check it against the file it was made from.

Static checks only: nothing here runs the contract (that is the
transformation's job). Each check reads the contract's instructions and the
file's own columns and values -- every field accounted for, the required ones
filled, every product code a master SKU, every rule value covered, revenue not
read from a claim or price column, periods inside the period the file states,
every store label above the header present, every cell a field is read from
filled, every figure and date written in a way the contract's steps can read,
no total column melted in with the outlets it adds up, every row filter
matching rows of the file. (One check, a store keeping to
one retailer, reads the rows the transformation made instead; it is called on
them by whoever ran it -- see check_store_channels.)
A check that fails names the fields it implicates, and those fields'
confidence comes from the checks (see field_confidence), so a reviewer is
pointed at what actually went wrong.

Pure: the parsed file, its layout, a validated contract and the master SKU
codes in; a list of checks out. No GCS, no database, no model.
"""

import re
from collections import Counter

import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import value_parsing
from app.services.layout_detection import filename_period
from app.services.mapping_contract import (
    DATE_TRANSFORMS,
    EMPTY_TRANSFORMS,
    MEASURE_FIELDS,
    NUMBER_TRANSFORMS,
    REQUIRED_FIELDS,
    cell_period,
    cell_value,
    filtered_rows,
    group_columns,
    label_cells,
    label_row,
    read_contract,
    reads_headings,
    resolve_selector,
    rows_matching,
    rule_matches,
    table_rows,
    with_file_columns,
)

# A column with one of these words in its name is a claim against the
# supplier, a price or a cost -- never the gross sales value of units sold.
NOT_REVENUE = re.compile(
    r"claim|contra|rebate|price|cost|support|gst|discount|margin|allowance", re.IGNORECASE
)
# Units times a price or cost per unit is sales value (SingHealth's units x
# Promo cost); units times a claim or rebate per unit is still a claim.
NOT_A_UNIT_PRICE = re.compile(
    r"claim|contra|rebate|support|discount|margin|allowance", re.IGNORECASE
)
# Above this share of negative quantities, sales are probably recorded as
# negative (SAP postings) and the contract should negate them.
NEGATIVE_SHARE = 0.5

# Above this share of a column's values that the contract's steps cannot read
# as numbers or dates, the column is written in a way the contract does not
# handle ("$1,250.50" with no parse_number) and the contract fails. Below it
# they are stray cells ("N/A" in one row): a warning, and those rows are
# rejected when the file loads.
UNREADABLE_SHARE = 0.1
# How many unreadable values a message quotes.
VALUES_QUOTED = 5

LEVEL_ORDER = {"error": 0, "warning": 1, "info": 2}


def _check(check_id, level, passed, message, fields=(), evidence=None) -> dict:
    return {
        "id": check_id,
        "level": level,
        "passed": passed,
        "message": message,
        "fields": list(fields),
        "evidence": evidence or {},
    }


def _present(series: pd.Series) -> pd.Series:
    values = series.dropna().astype(str).str.strip()
    return values[values != ""]


# ---- Reading a code table -------------------------------------------------------

def _rule_matches(op: str, value: str, text: str, case_sensitive: bool) -> bool:
    return rule_matches(text, op, value, case_sensitive)


def _lookup(text: str, transform: dict) -> str | None:
    """
    What one code-table instruction (value_map or rules) says a value becomes,
    or None when it says nothing about it and has no default.
    """
    case_sensitive = transform.get("case_sensitive", False)
    if transform["type"] == "value_map":
        for key, output in (transform.get("values") or {}).items():
            if (key == text) if case_sensitive else (key.casefold() == text.casefold()):
                return output
    else:
        for rule in transform.get("rules") or []:
            if _rule_matches(rule["op"], rule["value"], text, case_sensitive):
                return rule["output"]
    return transform.get("default")


def _translated_code(code: str, transforms: list[dict]) -> str:
    """The master SKU a product code reads as under the sku field's code table."""
    value = code
    for transform in transforms:
        if transform["type"] in ("value_map", "rules"):
            looked_up = _lookup(value, transform)
            value = looked_up if looked_up is not None else value
        elif transform["type"] == "regex_extract":
            match = re.search(transform["pattern"], value)
            value = match.group(transform.get("group", 1)) if match else value
    return value


def _heading_sku_codes(frame: pd.DataFrame, layout: dict | None, contract: dict, entry: dict) -> list[dict]:
    """
    The product codes of a file with one column per product: the codes are the
    melt group's headings, or the cells above or below them. Each is counted
    once per column carrying it, since there are no rows of codes to count.
    """
    group = next((g for g in contract.get("melt_groups") or [] if g["id"] == entry.get("melt_group")), None)
    if group is None:
        return []
    columns = resolve_selector(group.get("select") or {}, list(frame.columns))
    label = next((item for item in group.get("labels") or [] if item["target"] == "sku"), None)
    if group["key"]["target"] == "sku" or (label and reads_headings(label)):
        pattern = group["key"].get("pattern") if group["key"]["target"] == "sku" else None
        found = [re.search(pattern, column) if pattern else None for column in columns]
        values = [match.group(1) if match else column for match, column in zip(found, columns)]
    elif label:
        cells = label_cells(label, layout)
        values = [cells.get(column) for column in columns]
    else:
        return []

    transforms = entry.get("transforms") or []
    return [
        {"code": code, "sku": _translated_code(code, transforms), "description": None, "rows": count}
        for code, count in Counter(value for value in values if value).items()
    ]


def sku_codes(frame: pd.DataFrame, contract: dict, layout: dict | None = None) -> list[dict]:
    """
    Every product code in the file, with what the contract's code table makes
    of it, the file's description of it (when product_name is read from a
    column), and how many rows carry it. What the review screen's code table
    is built from. `layout` lets codes written over or under the column
    headings be read, and keeps a row of headings out of the data.
    """
    contract = with_file_columns(contract, list(frame.columns))
    frame = _sales_rows(table_rows(frame, contract, layout), contract)
    fields = contract.get("fields") or {}
    entry = fields.get("sku") or {}
    source = entry.get("source")
    if entry.get("status") == "mapped" and entry.get("melt_group"):
        return _heading_sku_codes(frame, layout, contract, entry)
    if entry.get("status") != "mapped" or source not in frame:
        return []
    name = fields.get("product_name") or {}
    describe = name.get("source") if name.get("status") == "mapped" and name.get("source") in frame else None

    codes = frame[source].map(lambda v: None if pd.isna(v) else str(v).strip())
    rows = []
    for code, group in frame.groupby(codes, sort=False):
        if not code:
            continue
        description = None
        if describe:
            present = _present(group[describe])
            description = present.iloc[0] if not present.empty else None
        rows.append({
            "code": code,
            "sku": _translated_code(code, entry.get("transforms") or []),
            "description": description,
            "rows": int(len(group)),
        })
    return rows


# ---- The period the file says it covers -------------------------------------------

def stated_period(layout: dict, filename: str) -> dict | None:
    """
    The period the file states for itself: its title or preamble first (or,
    when they state none, a heading that is a month: "Aug-26"), then its
    filename (layout_detection.filename_period -- FairPrice:
    "..._01-01-2026_01-08-2026_1.txt"; NHG: "... Aug 26.xlsx").
    """
    stated = (layout or {}).get("stated_period")
    if stated:
        return {"start": stated["start"], "end": stated["end"], "source": stated.get("source", "title")}
    return filename_period(filename)


def _period_dates(frame: pd.DataFrame, contract: dict, layout: dict | None = None) -> pd.Series | None:
    """
    The dates the contract reads periods from: period headers, a date column,
    the one date typed in, or the one cell it reads.
    """
    entry = (contract.get("fields") or {}).get("period_start") or {}
    if entry.get("status") == "constant":
        return pd.to_datetime(pd.Series([entry.get("value")]), errors="coerce").dropna()
    if entry.get("from_cell"):
        return pd.to_datetime(pd.Series([cell_period(cell_value(layout, entry["from_cell"]))])).dropna()
    if entry.get("melt_group"):
        group = next((g for g in contract.get("melt_groups") or [] if g["id"] == entry["melt_group"]), None)
        if not group:
            return None
        headers = pd.Series(resolve_selector(group.get("select") or {}, list(frame.columns)))
        key = group.get("key") or {}
        keys = headers.str.extract(key["pattern"], expand=False) if key.get("pattern") else headers
        return value_parsing.read_dates(keys, key.get("date_format")).dropna()
    if entry.get("source") in frame:
        return value_parsing.read_dates(_present(frame[entry["source"]]), _date_format(entry)).dropna()
    return None


def _date_format(entry: dict) -> str | None:
    """The format a field's date step reads by; None is ISO dates, as the transformation reads them."""
    formats = [t.get("format") for t in entry.get("transforms") or [] if t.get("type") in DATE_TRANSFORMS]
    return formats[0] if formats else None


def _sales_rows(frame: pd.DataFrame, contract: dict) -> pd.DataFrame:
    """
    The rows the contract's filters leave, which every other check reads: a
    product code on a row the contract drops is not one it loads. A filter
    that cannot be applied leaves the rows as they are; its own check says so.
    """
    try:
        return filtered_rows(frame, contract)
    except ValueError:
        return frame


# ---- Individual checks ---------------------------------------------------------------

def _check_accounted(contract: dict) -> dict:
    missing = [field for field in BUSINESS_COLUMNS if field not in (contract.get("fields") or {})]
    return _check(
        "fields_accounted", "error", not missing,
        "Every target field is accounted for." if not missing else f"No decision for: {', '.join(missing)}.",
        missing, {"missing": missing},
    )


def _check_required(contract: dict) -> list[dict]:
    fields = contract.get("fields") or {}
    checks = []
    for field in REQUIRED_FIELDS:
        entry = fields.get(field) or {"status": "not_available"}
        ok = entry["status"] != "not_available"
        checks.append(_check(
            f"required_{field}", "error", ok,
            f"{field} is filled ({entry['status']})." if ok
            else f"{field} is required but marked not available: {(entry.get('reason') or 'no reason given').rstrip('.')}.",
            [field],
        ))
    return checks


def _check_skus(frame: pd.DataFrame, layout: dict, contract: dict, master_skus: set[str] | None) -> dict:
    """Every product code in the file reads, through the code table, as a master SKU."""
    if (contract.get("fields") or {}).get("sku", {}).get("status") != "mapped":
        return _check("sku_codes", "info", True, "The SKU is not read from the file.", ["sku"])
    if master_skus is None:
        return _check(
            "sku_codes", "error", False,
            "The SKU master could not be read, so the product codes could not be checked.", ["sku"],
        )
    codes = sku_codes(frame, contract, layout)
    unknown = [item for item in codes if item["sku"] not in master_skus]
    if not unknown:
        return _check(
            "sku_codes", "error", True,
            f"All {len(codes)} product codes in the file are master SKUs.", ["sku"],
            {"codes": len(codes)},
        )
    listed = ", ".join(item["code"] for item in unknown[:10])
    return _check(
        "sku_codes", "error", False,
        f"{len(unknown)} of {len(codes)} product codes are not master SKUs: {listed}. "
        "Map each one to its master SKU in the code table, or add the product to the SKU master.",
        ["sku"],
        {"unknown": [{"code": i["code"], "reads_as": i["sku"], "description": i["description"], "rows": i["rows"]} for i in unknown]},
    )


def _label_values(layout: dict, group: dict, target: str, columns: list[str]) -> list[str] | None:
    """The cells a melt group's label reads above or below its columns (an outlet's code over its name)."""
    label = next((item for item in group.get("labels") or [] if item["target"] == target), None)
    if label is None:
        return None
    if reads_headings(label):
        return sorted(columns)
    cells = label_cells(label, layout)
    return sorted({cells[column] for column in columns if column in cells})


def _rule_inputs(frame: pd.DataFrame, layout: dict, contract: dict, entry: dict, transform: dict) -> list[str] | None:
    """The distinct values a code-mapping rule is applied to, read from the file."""
    if transform.get("column") in frame:
        return sorted(set(_present(frame[transform["column"]])))
    if entry.get("source") in frame:
        return sorted(set(_present(frame[entry["source"]])))
    if entry.get("from_field"):
        store = (contract.get("fields") or {}).get(entry["from_field"]) or {}
        group = next((g for g in contract.get("melt_groups") or [] if g["id"] == store.get("melt_group")), None)
        if group:
            columns = resolve_selector(group.get("select") or {}, list(frame.columns))
            # The headers hold the values, or the cells above them do.
            if group["key"]["target"] != entry["from_field"]:
                return _label_values(layout, group, entry["from_field"], columns)
            return columns
        if store.get("source") in frame:
            return sorted(set(_present(frame[store["source"]])))
    return None


def _check_rules(frame: pd.DataFrame, layout: dict, contract: dict) -> list[dict]:
    """
    Every value a code-mapping rule meets is covered by a rule or its default.

    Rules that match none of the values while a default catches them all
    are worth a warning: the rules were most likely written for other
    values -- outlet names, say, after the field they read became codes.
    """
    checks = []
    for target, entry in (contract.get("fields") or {}).items():
        if target == "sku":
            continue  # the code table has its own check
        for transform in entry.get("transforms") or []:
            if transform["type"] not in ("rules", "value_map"):
                continue
            inputs = _rule_inputs(frame, layout, contract, entry, transform)
            if inputs is None:
                continue
            covered = [v for v in inputs if _lookup(v, {**transform, "default": None}) is not None]
            rest = [v for v in inputs if v not in covered]
            has_default = bool(transform.get("default"))
            ok = has_default or not rest
            if ok and inputs and not covered and transform["type"] == "rules":
                checks.append(_check(
                    f"rules_{target}", "warning", False,
                    f"{target}: none of the {len(inputs)} distinct values match a rule, so every row gets "
                    f"{transform['default']!r}. Check the rules are written for these values: {', '.join(inputs[:10])}.",
                    [target],
                    {"matched": [], "default": rest[:20]},
                ))
                continue
            checks.append(_check(
                f"rules_{target}", "info" if ok else "error", ok,
                f"{target}: {len(covered)} of {len(inputs)} distinct values match a rule"
                + (f"; the other {len(rest)} get {transform['default']!r}." if rest and has_default else ".")
                if ok else f"{target}: {len(rest)} values match no rule and there is no default: {', '.join(rest[:10])}.",
                [target],
                {"matched": covered[:20], "default": rest[:20]},
            ))
    return checks


def _measure_columns(frame: pd.DataFrame, contract: dict, field: str) -> list[str]:
    entry = (contract.get("fields") or {}).get(field) or {}
    if entry.get("source"):
        return [entry["source"]]
    if entry.get("melt_group"):
        group = next((g for g in contract.get("melt_groups") or [] if g["id"] == entry["melt_group"]), None)
        if group:
            return resolve_selector(group.get("select") or {}, list(frame.columns))
    return []


def _check_revenue(frame: pd.DataFrame, contract: dict) -> dict:
    suspect = [c for c in _measure_columns(frame, contract, "revenue") if NOT_REVENUE.search(c)]
    entry = (contract.get("fields") or {}).get("revenue") or {}
    suspect += [
        t["column"]
        for t in entry.get("transforms") or []
        if t.get("type") == "multiply" and NOT_A_UNIT_PRICE.search(t["column"])
    ]
    return _check(
        "revenue_source", "error", not suspect,
        "Revenue is not read from a claim, price or cost column." if not suspect
        else f"Revenue is read from {', '.join(suspect)}, which is a claim, price or cost, not sales value.",
        ["revenue"], {"columns": suspect},
    )


def _check_quantity_sign(frame: pd.DataFrame, contract: dict) -> dict:
    """Mostly negative quantities with no negate instruction: sales recorded as negative."""
    columns = [c for c in _measure_columns(frame, contract, "quantity_units") if c in frame]
    if not columns:
        return _check("quantity_sign", "info", True, "Quantity is not read from the file.", ["quantity_units"])
    values = pd.to_numeric(pd.concat([_present(frame[c]) for c in columns]), errors="coerce").dropna()
    values = values[values != 0]
    share = float((values < 0).mean()) if len(values) else 0.0
    entry = (contract.get("fields") or {}).get("quantity_units") or {}
    negated = any(t.get("type") == "negate" for t in entry.get("transforms") or [])
    ok = negated or share <= NEGATIVE_SHARE
    return _check(
        "quantity_sign", "warning", ok,
        (f"{share:.0%} of quantities are negative and the contract negates them." if negated
         else f"{share:.0%} of quantities are negative.") if ok
        else f"{share:.0%} of quantities are negative but the contract does not negate them: "
             "sales may be recorded as negative numbers.",
        ["quantity_units"], {"negative_share": round(share, 3), "negated": negated},
    )


def _check_stated_month(layout: dict, source: str = "stated_period", filename: str | None = None) -> dict:
    """A contract that reads the period the file states needs a title, a heading or a name stating one month."""
    if source == "filename_period":
        stated = filename_period(filename)
        missing = f"The period is read from the file's name, but {str(filename)!r} states no month."
    else:
        stated = (layout or {}).get("stated_period")
        missing = (
            "The period is read from what the file states, but this file states no period in its title "
            "or as a month heading."
        )
    if not stated:
        return _check("period", "error", False, missing, ["period_start"], {"stated": None})
    source = stated.get("source", "title")
    one_month = pd.Timestamp(stated["start"]).to_period("M") == pd.Timestamp(stated["end"]).to_period("M")
    return _check(
        "period", "error", one_month,
        f"Every row is dated to the month the {source} states: {stated['start']} to {stated['end']}."
        if one_month
        else f"The {source} states {stated['start']} to {stated['end']}, more than one month, "
             "so rows cannot be dated to a month from it.",
        ["period_start"], {"stated": stated},
    )


def _check_period(frame: pd.DataFrame, layout: dict, contract: dict, filename: str) -> dict:
    entry = (contract.get("fields") or {}).get("period_start") or {}
    if entry.get("from_layout"):
        return _check_stated_month(layout, entry["from_layout"], filename)
    stated = stated_period(layout, filename)
    dates = _period_dates(frame, contract, layout)
    if stated is None or dates is None or dates.empty:
        return _check("period", "info", True, "The file states no period to check against.", ["period_start"])
    first, last = pd.Timestamp(stated["start"]).to_period("M"), pd.Timestamp(stated["end"]).to_period("M")
    outside = sorted({str(m) for m in dates.dt.to_period("M") if m < first or m > last})
    return _check(
        "period", "error", not outside,
        f"Every period falls within {stated['start']} to {stated['end']}, as the {stated['source']} states."
        if not outside
        else f"Periods {', '.join(outside)} fall outside {stated['start']} to {stated['end']} ({stated['source']}).",
        ["period_start"], {"stated": stated, "outside": outside},
    )


def _check_labels(frame: pd.DataFrame, layout: dict, contract: dict) -> list[dict]:
    """Every column a melt group reads a label for has a cell in the label's row."""
    checks = []
    for group in contract.get("melt_groups") or []:
        columns = resolve_selector(group.get("select") or {}, list(frame.columns))
        for label in group.get("labels") or []:
            if reads_headings(label):
                continue  # the headings themselves are always there
            row = label_row(label, layout)
            where = "below" if label.get("rows_below") is not None else "above"
            cells = label_cells(label, layout)
            missing = [column for column in columns if column not in cells]
            target = label["target"]
            checks.append(_check(
                f"labels_{target}", "error", not missing,
                f"{target}: read from row {row} {where} all {len(columns)} columns." if not missing
                else f"{target}: row {row} has nothing {where} {', '.join(missing[:10])}.",
                [target],
                {"row": row, "read": {c: cells[c] for c in columns[:20] if c in cells}, "missing": missing},
            ))
    return checks


def _check_cells(layout: dict, contract: dict) -> list[dict]:
    """
    Every field read from one cell finds a value there, and a period cell
    names a month or a date. A cell is read as it is, before any steps, so a
    period cell with steps is only checked for a value.
    """
    checks = []
    for target, entry in (contract.get("fields") or {}).items():
        reference = entry.get("from_cell")
        if not reference:
            continue
        value = cell_value(layout, reference)
        if value is None:
            passed, message = False, f"{target}: cell {reference} is empty in this file."
        elif target == "period_start" and not entry.get("transforms") and cell_period(value) is None:
            passed, message = False, f"{target}: cell {reference} holds {value!r}, which is not a month or a date."
        else:
            passed, message = True, f"{target}: {value!r} from cell {reference}, on every row."
        checks.append(_check(
            f"cell_{target}", "error", passed, message, [target], {"cell": reference, "value": value},
        ))
    return checks


# ---- How the values are written ----------------------------------------------------------

# Steps whose effect on a value can be told without the rest of the row. A
# field that first reworks its text (takes part of it, looks it up) is read
# only when the contract runs, so its values are not judged here.
_READ_STATICALLY = (*NUMBER_TRANSFORMS, *EMPTY_TRANSFORMS, *DATE_TRANSFORMS)


def _as_written(frame: pd.DataFrame, contract: dict, field: str) -> pd.Series | None:
    """
    The values a field's first reading step meets, placeholders its blank_if
    names set aside; None when the field is not read straight from columns.
    """
    entry = (contract.get("fields") or {}).get(field) or {}
    transforms = entry.get("transforms") or []
    if entry.get("status") != "mapped" or any(t["type"] not in _READ_STATICALLY for t in transforms):
        return None
    columns = [c for c in _measure_columns(frame, contract, field) if c in frame]
    if not columns:
        return None
    values = pd.concat([_present(frame[column]) for column in columns], ignore_index=True)
    tokens = {token.casefold() for t in transforms if t["type"] == "blank_if" for token in t["tokens"]}
    return values[~values.str.casefold().isin(tokens)]


def _unreadable_check(field: str, values: pd.Series, readable: pd.Series, advice: str) -> dict:
    unreadable = values[~readable]
    share = len(unreadable) / len(values) if len(values) else 0.0
    examples = list(dict.fromkeys(unreadable.tolist()))
    quoted = ", ".join(repr(value) for value in examples[:VALUES_QUOTED])
    return _check(
        f"values_{field}", "error" if share > UNREADABLE_SHARE else "warning", not len(unreadable),
        f"{field}: all {len(values)} values read as the contract reads them." if not len(unreadable)
        else f"{field}: {len(unreadable)} of {len(values)} values cannot be read as the contract reads them "
             f"({quoted}). {advice}",
        [field],
        {"unreadable": len(unreadable), "values": len(values), "examples": examples[:20]},
    )


def _check_values(frame: pd.DataFrame, contract: dict) -> list[dict]:
    """
    The figures and dates a field reads are written in a way its steps can
    read: plain numbers unless it has parse_number, ISO dates unless its date
    step has a format. What the transformation cannot read it rejects row by
    row, so a column written another way would load nothing.
    """
    checks = []
    fields = contract.get("fields") or {}
    for field in (*MEASURE_FIELDS, "pack_size"):
        values = _as_written(frame, contract, field)
        if values is None or values.empty:
            continue
        parse = next((t for t in fields[field].get("transforms") or [] if t["type"] == "parse_number"), None)
        if parse:
            readable = value_parsing.read_numbers(values, parse.get("decimal", ".")).notna()
        else:
            readable = pd.to_numeric(values, errors="coerce").notna()
        traits = value_parsing.number_traits(values[~readable].tolist()) if not parse else None
        advice = (
            f"They are numbers written with {', '.join(traits['written_with']) or 'another format'}: add "
            f"parse_number (decimal {traits['decimal']!r})." if traits
            else "Use blank_if for placeholders such as 'N/A', or mark the field not available if these are not figures."
        )
        checks.append(_unreadable_check(field, values, readable, advice))

    entry = fields.get("period_start") or {}
    values = _as_written(frame, contract, "period_start") if entry.get("source") else None
    if values is not None and not values.empty:
        date_format = _date_format(entry)
        readable = value_parsing.read_dates(values, date_format).notna()
        formats = value_parsing.date_formats(values.tolist())
        advice = (
            f"They read as dates with format {' or '.join(repr(f) for f in formats[:2])}: give it to parse_date or month_start."
            if formats else "Give parse_date or month_start the strptime format these dates are written in."
        )
        checks.append(_unreadable_check("period_start", values, readable, advice))
    return checks


def _check_melted_totals(frame: pd.DataFrame, layout: dict, contract: dict) -> list[dict]:
    """
    No melt group takes in a column that adds up the others. An empty column
    is not held against it: an outlet that sold nothing this month has one.
    """
    totals = set((layout or {}).get("total_columns") or [])
    checks = []
    for group in contract.get("melt_groups") or []:
        columns = resolve_selector(group.get("select") or {}, list(frame.columns))
        taken = [column for column in columns if column in totals]
        if taken:
            checks.append(_check(
                f"melted_totals_{group['value_target']}", "error", False,
                f"Melt group {group['id']!r} takes in {', '.join(taken)}, which is a total column: its figures "
                "would be counted on top of the columns it adds up. End the selection before it.",
                [group["value_target"]], {"columns": taken},
            ))
    return checks


def _check_filters(frame: pd.DataFrame, contract: dict) -> list[dict]:
    """Every row filter can be applied, leaves rows to load and matches something."""
    checks = []
    rows = frame
    for index, row_filter in enumerate(contract.get("filters") or [], start=1):
        said = (
            f"{row_filter['action']} rows where {row_filter['column']!r} "
            + ("is empty" if row_filter["op"] == "empty" else f"{row_filter['op']} {row_filter['value']!r}")
        )
        try:
            matched = rows_matching(rows, row_filter)
        except ValueError as exc:
            checks.append(_check(f"filter_{index}", "error", False, f"Row filter ({said}) cannot be applied: {exc}."))
            continue
        removed = int(matched.sum()) if row_filter["action"] == "drop" else int((~matched).sum())
        left = len(rows) - removed
        evidence = {"filter": row_filter, "rows": len(rows), "removed": removed}
        if not left:
            checks.append(_check(f"filter_{index}", "error", False, f"Row filter ({said}) leaves no rows to load.", evidence=evidence))
        elif not removed:
            checks.append(_check(
                f"filter_{index}", "warning", False,
                f"Row filter ({said}) removes none of the {len(rows)} rows: check it is written for this file's values.",
                evidence=evidence,
            ))
        else:
            checks.append(_check(
                f"filter_{index}", "info", True,
                f"Row filter ({said}) leaves out {removed} of {len(rows)} rows.", evidence=evidence,
            ))
        rows = rows[~matched if row_filter["action"] == "drop" else matched]
    return checks


def _check_unsupported(contract: dict) -> list[dict]:
    """What the proposal said the file needs that no instruction can do, for a person to settle."""
    return [
        _check(
            f"unsupported_{index}", "warning", False,
            f"Flagged as not supported{' for ' + item['field'] if item.get('field') else ''}: {item['issue']}",
            [item["field"]] if item.get("field") else [],
        )
        for index, item in enumerate(contract.get("unsupported") or [], start=1)
    ]


def _check_not_available(contract: dict) -> dict:
    missing = {
        target: entry.get("reason")
        for target, entry in (contract.get("fields") or {}).items()
        if entry.get("status") == "not_available"
    }
    return _check(
        "not_available", "info", True,
        f"Not in this file: {', '.join(missing)}." if missing else "Every field is filled.",
        evidence={"fields": missing},
    )


def _check_instructions(contract: dict) -> dict:
    """What the contract tells the transformation besides the fields, said in words."""
    layout = contract.get("layout") or {}
    parts = []
    if layout:
        where = f"sheet {layout['sheet']!r}, " if layout.get("sheet") else ""
        if layout.get("stacked_sheets"):
            where = "every sheet with these headers, stacked, "
        parts.append(f"data on {where}header row {layout.get('header_row', 1)}")
        if layout.get("fill_down"):
            parts.append(f"fill down {', '.join(layout['fill_down'])}")
    filters = contract.get("filters") or []
    if filters:
        parts.append(f"{len(filters)} row filter{'s' if len(filters) > 1 else ''} applied first")
    aggregate = contract.get("aggregate")
    parts.append(f"rolled up to one row per {', '.join(aggregate['by'])} each {aggregate['period']}"
                 if aggregate else "rows kept at the file's own grain")
    return _check("instructions", "info", True, "The transformation is told: " + "; ".join(parts) + ".")


# ---- One retailer per store (on transformed rows) ---------------------------------------
#
# The one check here that reads the contract's output, not the file: whether a
# store keeps to one channel can only be told once the retailer rule has run on
# every row. It is not part of run_checks; the mapping test, approval and every
# load call it on the rows the transformation made.

# How many stores a message names before "and n more".
STORES_NAMED = 5


def store_channel_conflicts(rows: pd.DataFrame) -> dict[str, list[str]]:
    """
    Each store code these rows send to more than one retailer, with the
    retailers. A store is sold through one of a customer's retailers -- a
    shop is offline, a website online -- so a retailer rule that splits one
    store's rows (by a column that varies within the store) would make it two
    stores. Rows with no store code are customer-level totals, which each
    channel has one of, so they are left out.
    """
    if rows.empty or "store_code" not in rows or "retailer" not in rows:
        return {}
    pairs = rows[["store_code", "retailer"]].dropna().astype(str)
    pairs = pairs.assign(store_code=pairs["store_code"].str.strip(), retailer=pairs["retailer"].str.strip())
    pairs = pairs[(pairs["store_code"] != "") & (pairs["retailer"] != "")]
    retailers = pairs.groupby("store_code")["retailer"].unique()
    return {
        str(code): sorted(names)
        for code, names in retailers.items()
        if len(names) > 1
    }


def describe_store_conflicts(conflicts: dict[str, list[str]]) -> str:
    """The conflicts in a sentence: "AJ goes to a and b; BK goes to …", the first few only."""
    named = [f"{code} goes to {' and '.join(names)}" for code, names in list(conflicts.items())[:STORES_NAMED]]
    more = len(conflicts) - len(named)
    return "; ".join(named) + (f"; and {more} more" if more > 0 else "")


def check_store_channels(rows: pd.DataFrame) -> dict:
    """The store_channel_conflicts of the transformed rows, as a check that blocks approval."""
    conflicts = store_channel_conflicts(rows)
    if not conflicts:
        return _check("store_channels", "error", True, "Every store goes to one retailer.", ["retailer", "store_code"])
    return _check(
        "store_channels", "error", False,
        f"A store goes to more than one retailer: {describe_store_conflicts(conflicts)}. A store belongs to one "
        "channel, so decide the retailer by something that names the store (its code, name or format), not by "
        "something that changes from row to row within a store.",
        ["retailer", "store_code"],
        {"stores": [f"{code} → {', '.join(names)}" for code, names in conflicts.items()]},
    )


# ---- Running them ---------------------------------------------------------------------

def run_checks(
    frame: pd.DataFrame,
    layout: dict,
    contract: dict,
    filename: str,
    master_skus: set[str] | None,
) -> list[dict]:
    """
    Every static check, most serious first. `master_skus` is the SKU master's
    codes; None when it could not be read, which fails the product-code check.
    """
    contract = with_file_columns(contract, list(frame.columns))
    # A row of headings the contract reads under the header is not data.
    frame = table_rows(frame, contract, layout)
    filter_checks = _check_filters(frame, contract)
    frame = _sales_rows(frame, contract)
    checks = [
        _check_accounted(contract),
        *_check_required(contract),
        _check_skus(frame, layout, contract, master_skus),
        *_check_rules(frame, layout, contract),
        _check_revenue(frame, contract),
        _check_quantity_sign(frame, contract),
        _check_period(frame, layout, contract, filename),
        *_check_labels(frame, layout, contract),
        *_check_cells(layout, contract),
        *_check_values(frame, contract),
        *_check_melted_totals(frame, layout, contract),
        *filter_checks,
        *_check_unsupported(contract),
        _check_not_available(contract),
        _check_instructions(contract),
    ]
    checks.sort(key=lambda c: (c["passed"], LEVEL_ORDER[c["level"]]))
    return checks


def failures(checks: list[dict]) -> list[dict]:
    """The checks that block a contract: errors that did not pass."""
    return [c for c in checks if c["level"] == "error" and not c["passed"]]


def unused_columns(contract: dict, columns: list[str]) -> list[str]:
    """The file's columns the contract never reads: no field, transform or melt group uses them."""
    contract = read_contract(contract)
    read = {column for selected in group_columns(contract, columns).values() for column in selected}
    for entry in (contract.get("fields") or {}).values():
        read.add(entry.get("source"))
        for transform in entry.get("transforms") or []:
            read.add(transform.get("column"))
            read.update(transform.get("columns") or [])
    read.update(row_filter.get("column") for row_filter in contract.get("filters") or [])
    return [column for column in columns if column not in read]


def field_confidence(contract: dict, checks: list[dict], columns: list[str] | None = None) -> dict:
    """
    A copy of the contract whose confidence comes from the checks.

    A field implicated by a failed error check is "low", by a failed warning
    "medium". The proposal's own confidence can lower that but never raise it:
    a passing check is evidence, a model's "high" is not.

    "Not in this file" is the one decision no check can test, so while the
    file has `columns` the contract leaves unread it is at most "medium": one
    of them may hold the field (FairPrice's MCH column is the product range).
    """
    contract = read_contract(contract)
    worst: dict[str, str] = {}
    for check in checks:
        if check["passed"] or check["level"] == "info":
            continue
        level = "low" if check["level"] == "error" else "medium"
        for field in check["fields"]:
            if worst.get(field) != "low":
                worst[field] = level
    if columns and unused_columns(contract, columns):
        for target, entry in (contract.get("fields") or {}).items():
            if entry.get("status") == "not_available" and worst.get(target) != "low":
                worst[target] = "medium"

    rank = {"low": 0, "medium": 1, "high": 2}
    for target, entry in (contract.get("fields") or {}).items():
        entry["confidence"] = min(worst.get(target, "high"), entry.get("confidence", "low"), key=rank.__getitem__)
    for group in contract.get("melt_groups") or []:
        from_checks = min(
            worst.get(group["value_target"], "high"), worst.get(group["key"]["target"], "high"), key=rank.__getitem__,
        )
        group["confidence"] = min(from_checks, group.get("confidence", "low"), key=rank.__getitem__)
    return contract
