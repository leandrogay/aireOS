"""
Is a contract right? Check it against the file it was made from.

Static checks only: nothing here runs the contract (that is the
transformation's job). Each check reads the contract's instructions and the
file's own columns and values -- every field accounted for, the required ones
filled, every product code a master SKU, every rule value covered, revenue not
read from a claim or price column, periods inside the period the file states,
every store label above the header present.
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
from app.services.mapping_contract import REQUIRED_FIELDS, group_columns, read_contract, resolve_selector

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

FILENAME_RANGE = re.compile(r"(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{4})")
FILENAME_MONTH = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]+(\d{4}|\d{2})\b",
    re.IGNORECASE,
)

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
    if op == "regex":
        return re.search(value, text, 0 if case_sensitive else re.IGNORECASE) is not None
    if not case_sensitive:
        text, value = text.casefold(), value.casefold()
    return {
        "equals": text == value,
        "startswith": text.startswith(value),
        "endswith": text.endswith(value),
        "contains": value in text,
    }.get(op, False)


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
    melt group's headings, or the cells above them. Each is counted once per
    column carrying it, since there are no rows of codes to count.
    """
    group = next((g for g in contract.get("melt_groups") or [] if g["id"] == entry.get("melt_group")), None)
    if group is None:
        return []
    columns = resolve_selector(group.get("select") or {}, list(frame.columns))
    label = next((item for item in group.get("labels") or [] if item["target"] == "sku"), None)
    if group["key"]["target"] == "sku" or (label and label["rows_above"] == 0):
        pattern = group["key"].get("pattern") if group["key"]["target"] == "sku" else None
        found = [re.search(pattern, column) if pattern else None for column in columns]
        values = [match.group(1) if match else column for match, column in zip(found, columns)]
    elif label:
        row = int((layout or {}).get("header_row") or 1) - label["rows_above"]
        cells = next((item["cells"] for item in (layout or {}).get("rows_above_header") or [] if item["row"] == row), {})
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
    is built from. `layout` lets codes written over the column headings be read.
    """
    contract = read_contract(contract)
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
    The period the file states for itself: its title or preamble first, then
    its filename (FairPrice: "..._01-01-2026_01-08-2026_1.txt"; NHG: "... Aug
    26.xlsx"). A date in a filename that is not a range or a month -- Sheng
    Siong's "03JUL26" is the statement's creation date -- is not read as one.
    """
    stated = (layout or {}).get("stated_period")
    if stated:
        return {"start": stated["start"], "end": stated["end"], "source": "title"}

    name = str(filename or "")
    match = FILENAME_RANGE.search(name)
    if match:
        start = pd.to_datetime(match.group(1), format="%d-%m-%Y", errors="coerce")
        end = pd.to_datetime(match.group(2), format="%d-%m-%Y", errors="coerce")
        if pd.notna(start) and pd.notna(end):
            return {"start": start.date().isoformat(), "end": end.date().isoformat(), "source": "filename"}

    match = FILENAME_MONTH.search(name.replace("_", " "))
    if match:
        year = match.group(2)
        year = int(year) + 2000 if len(year) == 2 else int(year)
        start = pd.to_datetime(f"1 {match.group(1)} {year}", format="%d %b %Y", errors="coerce")
        if pd.notna(start):
            end = start + pd.offsets.MonthEnd(0)
            return {"start": start.date().isoformat(), "end": end.date().isoformat(), "source": "filename"}
    return None


def _period_dates(frame: pd.DataFrame, contract: dict) -> pd.Series | None:
    """The dates the contract reads periods from: period headers, or a date column."""
    entry = (contract.get("fields") or {}).get("period_start") or {}
    if entry.get("melt_group"):
        group = next((g for g in contract.get("melt_groups") or [] if g["id"] == entry["melt_group"]), None)
        if not group:
            return None
        headers = pd.Series(resolve_selector(group.get("select") or {}, list(frame.columns)))
        key = group.get("key") or {}
        keys = headers.str.extract(key["pattern"], expand=False) if key.get("pattern") else headers
        return pd.to_datetime(keys, format=key.get("date_format"), errors="coerce").dropna()
    if entry.get("source") in frame:
        formats = [t.get("format") for t in entry.get("transforms") or [] if t.get("type") == "month_start"]
        return pd.to_datetime(
            _present(frame[entry["source"]]), format=(formats[0] if formats and formats[0] else "ISO8601"), errors="coerce"
        ).dropna()
    return None


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
            else f"{field} is required but marked not available: {entry.get('reason') or 'no reason given'}.",
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
    """The cells a melt group's label reads above its columns (an outlet's code over its name)."""
    label = next((item for item in group.get("labels") or [] if item["target"] == target), None)
    if label is None:
        return None
    if label["rows_above"] == 0:
        return sorted(columns)
    row = int((layout or {}).get("header_row") or 1) - label["rows_above"]
    cells = next((item["cells"] for item in (layout or {}).get("rows_above_header") or [] if item["row"] == row), {})
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


def _check_stated_month(layout: dict) -> dict:
    """A contract that reads its period from the file's title needs a title stating one month."""
    stated = (layout or {}).get("stated_period")
    if not stated:
        return _check(
            "period", "error", False,
            "The period is read from the file's title, but this file's title states no period.",
            ["period_start"], {"stated": None},
        )
    one_month = pd.Timestamp(stated["start"]).to_period("M") == pd.Timestamp(stated["end"]).to_period("M")
    return _check(
        "period", "error", one_month,
        f"Every row is dated to the month the title states: {stated['start']} to {stated['end']}."
        if one_month
        else f"The title states {stated['start']} to {stated['end']}, more than one month, "
             "so rows cannot be dated to a month from it.",
        ["period_start"], {"stated": stated},
    )


def _check_period(frame: pd.DataFrame, layout: dict, contract: dict, filename: str) -> dict:
    entry = (contract.get("fields") or {}).get("period_start") or {}
    if entry.get("from_layout") == "stated_period":
        return _check_stated_month(layout)
    stated = stated_period(layout, filename)
    dates = _period_dates(frame, contract)
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
    header_row = int((layout or {}).get("header_row") or 1)
    above = {item["row"]: item["cells"] for item in (layout or {}).get("rows_above_header") or []}
    for group in contract.get("melt_groups") or []:
        columns = resolve_selector(group.get("select") or {}, list(frame.columns))
        for label in group.get("labels") or []:
            if label["rows_above"] == 0:
                continue  # the headings themselves are always there
            row = header_row - label["rows_above"]
            cells = above.get(row) or {}
            missing = [column for column in columns if column not in cells]
            target = label["target"]
            checks.append(_check(
                f"labels_{target}", "error", not missing,
                f"{target}: read from row {row} above all {len(columns)} columns." if not missing
                else f"{target}: row {row} has nothing above {', '.join(missing[:10])}.",
                [target],
                {"row": row, "read": {c: cells[c] for c in columns[:20] if c in cells}, "missing": missing},
            ))
    return checks


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
        parts.append(f"data on {where}header row {layout.get('header_row', 1)}")
        if layout.get("fill_down"):
            parts.append(f"fill down {', '.join(layout['fill_down'])}")
    aggregate = contract.get("aggregate")
    parts.append(f"rolled up to one row per {', '.join(aggregate['by'])} each {aggregate['period']}"
                 if aggregate else "rows kept at the file's own grain")
    return _check("instructions", "info", True, "The transformation is told: " + "; ".join(parts) + ".")


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
    contract = read_contract(contract)
    checks = [
        _check_accounted(contract),
        *_check_required(contract),
        _check_skus(frame, layout, contract, master_skus),
        *_check_rules(frame, layout, contract),
        _check_revenue(frame, contract),
        _check_quantity_sign(frame, contract),
        _check_period(frame, layout, contract, filename),
        *_check_labels(frame, layout, contract),
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
        read.update(transform.get("column") for transform in entry.get("transforms") or [])
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
