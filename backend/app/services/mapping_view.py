"""Present GCS mapping contracts in the shape used by the review screen."""

import re
from typing import Any, Dict, List

import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import mapping_contract
from app.services.column_profile import review_column_groups
from app.services.mapping_contract import (
    DECIDABLE_FIELDS,
    REQUIRED_FIELDS,
    read_contract,
    resolve_selector,
    validate_contract,
)

# The fields a mapping must fill for an output row to exist.
REQUIRED_TARGET_FIELDS = list(REQUIRED_FIELDS)

# Every field a reviewer sees accounted for, in the order the review lists them.
CORE_TARGET_FIELDS = list(BUSINESS_COLUMNS)

# Fields a melt group can fill by itself, from its column headers. Kept for
# older review screens; every field now has its own rule saying how it is filled.
PERIOD_DERIVED_FIELDS = ["period_start", "period_end", "period_type"]

STATUS_DESCRIPTIONS = {
    "system": "The uploaded file's name",
    "derived": "Computed",
}


def _rule(
    target_field: str,
    source_columns: List[str],
    display: str,
    transform: Any,
    status: str,
    editable: bool,
    confidence: str = "high",
    rationale: str = "",
    reviewed: bool = False,
) -> Dict[str, Any]:
    return {
        "targetField": target_field,
        "sourceColumn": display,
        "sourceColumns": source_columns,
        "transform": transform,
        "status": status,
        "editable": editable,
        "confidence": confidence,
        "rationale": rationale,
        "reviewed": reviewed,
    }


def _describe(target: str, entry: dict, groups: dict) -> str:
    """One line saying how a field without a source column is filled."""
    status = entry.get("status")
    if status == "constant":
        return f"Always {entry.get('value')!r}"
    if status == "not_available":
        return f"Not in this file: {entry.get('reason') or 'no reason given'}"
    if status == "derived" and entry.get("from_field"):
        return f"From {entry['from_field']}"
    if status == "derived" and entry.get("from_layout") == "stated_period":
        return "The month the file's title states"
    if status == "derived" and target == "period_type":
        return "Read from the period column headers"
    if status == "mapped" and entry.get("melt_group") in groups:
        group = groups[entry["melt_group"]]
        label = next((item for item in group.get("labels") or [] if item["target"] == target), None)
        if label and label["rows_above"] == 0:
            return f"Read from the column headers of melt group {entry['melt_group']!r}"
        if label:
            return f"Read from the cells above the column headers of melt group {entry['melt_group']!r}"
        return f"Read from the column headers of melt group {entry['melt_group']!r}"
    return STATUS_DESCRIPTIONS.get(status, status or "")


def _melt_transform(group: dict, columns: list[str]) -> str:
    key = group.get("key") or {}
    noun = "period" if key.get("target") == "period_start" else "store"
    text = f"melt {len(columns)} {noun} columns; key -> {key.get('target')}"
    if key.get("pattern"):
        text += f" from /{key['pattern']}/"
    if key.get("date_format"):
        text += f" parsed as {key['date_format']}"
    return text


def contract_to_rules(
    contract: Dict[str, Any],
    reviewed_default: bool = False,
    columns: List[str] | None = None,
) -> List[Dict[str, Any]]:
    """
    One rule per target field, in schema order.

    A field read from a column is an editable rule naming that column. A field
    filled by a melt group's values is a locked rule over the group's columns,
    carrying the group (`meltGroup`) so it survives an edit to some other row.
    Every other field -- a constant, a derived field, the file's name,
    one not in this file -- is a locked rule with no column, carrying its
    contract entry (`field`) and a one-line `description`.

    reviewed_default fills in "reviewed" for contracts stored before the flag
    existed. A mapping that was already approved passes True: someone signed
    it off, and asking them to re-confirm rows they already confirmed is the
    bug the flag was added to fix.
    """
    current = read_contract(contract)
    columns = list(columns or [])
    groups = {group.get("id"): group for group in current.get("melt_groups") or []}
    fields = current.get("fields") or {}

    rules = []
    for target in BUSINESS_COLUMNS:
        entry = fields.get(target)
        if entry is None:
            entry = {"status": "not_available", "reason": "No decision was made for this field.", "confidence": "medium"}
        confidence = entry.get("confidence", "low")
        rationale = entry.get("rationale", "")
        reviewed = entry.get("reviewed", reviewed_default)

        if entry.get("status") == "mapped" and entry.get("source"):
            rule = _rule(
                target, [entry["source"]], entry["source"], entry.get("transforms") or None,
                "mapped", editable=True,
                confidence=confidence, rationale=rationale, reviewed=reviewed,
            )
            rules.append(rule)
            continue

        group = groups.get(entry.get("melt_group")) if entry.get("status") == "mapped" else None
        if group is not None and group.get("value_target") == target:
            try:
                group_cols = resolve_selector(group.get("select") or {}, columns)
            except Exception:
                group_cols = []
            if not group_cols:
                group_cols = list((group.get("select") or {}).get("columns") or [])
            display = (
                f"{group_cols[0]} (+{len(group_cols) - 1} more columns)"
                if len(group_cols) > 1
                else (group_cols[0] if group_cols else "")
            )
            rule = _rule(
                target, group_cols, display, _melt_transform(group, group_cols),
                "derived", editable=False,
                confidence=group.get("confidence", confidence),
                rationale=group.get("rationale", rationale),
                reviewed=group.get("reviewed", reviewed),
            )
            rule["meltGroup"] = group
            rule["field"] = entry
            rules.append(rule)
            continue

        rule = _rule(
            target, [], _describe(target, entry, groups), entry.get("transforms") or None,
            entry.get("status") or "not_available", editable=False,
            confidence=confidence, rationale=rationale, reviewed=reviewed,
        )
        rule["field"] = entry
        rule["description"] = _describe(target, entry, groups)
        if entry.get("status") == "not_available":
            rule["reason"] = entry.get("reason")
        rules.append(rule)

    return rules


def _annotation(rule: dict) -> dict:
    return {
        "confidence": rule.get("confidence") or "low",
        "rationale": rule.get("rationale") or "",
        "reviewed": rule.get("reviewed") is True,
    }


def rules_to_contract(rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Rebuild a contract from edited rules. Inverse of contract_to_rules.

    Locked rules are carried back from what they carry (`field`, `meltGroup`),
    with the reviewer's sign-off. An editable rule naming a column wins over a
    locked one for the same field: that is a reviewer assigning a column to a
    field the proposal said was not in the file. A field with no rule at all is
    left out, and validation records it as not available.
    """
    fields: Dict[str, Dict[str, Any]] = {}
    groups: Dict[str, Dict[str, Any]] = {}

    for rule in rules:
        target = rule.get("targetField")
        if not target or rule.get("editable", True):
            continue
        group = rule.get("meltGroup")
        if group:
            groups[group.get("id")] = {**group, **_annotation(rule)}
        entry = rule.get("field")
        if entry:
            fields[target] = {**entry, **_annotation(rule)}

    for rule in rules:
        target = rule.get("targetField")
        if not target or not rule.get("editable", True):
            continue
        source = (rule.get("sourceColumn") or "").strip()
        if not source or (target in fields and fields[target].get("source")):
            continue
        entry = {"status": "mapped", "source": source, **_annotation(rule)}
        transform = rule.get("transform")
        if isinstance(transform, dict):
            entry["transforms"] = [transform]
        elif isinstance(transform, list) and transform:
            entry["transforms"] = transform
        fields[target] = entry

    return {
        "fields": fields,
        "melt_groups": list(groups.values()),
    }


def _meta(rules: List[Dict[str, Any]], columns: List[str]) -> Dict[str, Any]:
    read = {column for rule in rules for column in rule.get("sourceColumns") or [] if column}
    by_field = {rule["targetField"]: rule for rule in rules}
    return {
        "unmapped": [column for column in columns if column not in read],
        "requiredMissing": [
            field
            for field in REQUIRED_TARGET_FIELDS
            if by_field.get(field, {}).get("status", "not_available") == "not_available"
        ],
    }


def required_missing_fields(contract: Dict[str, Any]) -> List[str]:
    """Required ingest targets a validated contract still cannot produce."""
    return mapping_contract.required_missing_fields(contract)


def validation_values(envelope: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    The column values a contract's transforms are checked against: the
    whole-file profile when the proposal stored one, else the few samples
    older proposals kept.
    """
    profile = envelope.get("column_profile") or {}
    if profile:
        return {column: entry.get("values", []) for column, entry in profile.items()}
    return envelope.get("column_samples") or {}


# How many headings a group shows the reviewer reading, and the gap in days
# between consecutive periods below which they are weeks rather than months.
READINGS_SHOWN = 3
WEEK_SPACING_DAYS = 8


def _period_type_from_dates(dates: list[pd.Timestamp]) -> str | None:
    ordered = sorted(set(dates))
    if len(ordered) < 2:
        return None
    gaps = sorted((b - a).days for a, b in zip(ordered, ordered[1:]))
    middle = gaps[len(gaps) // 2]
    return "week" if middle <= WEEK_SPACING_DAYS else "month"


def _read_keys(group: dict, columns: list[str]) -> tuple[list, str | None]:
    """Each column's key as the transformation will read it, or a problem."""
    key = group.get("key") or {}
    if key.get("target") != "period_start":
        return list(columns), None
    pattern, date_format = key.get("pattern"), key.get("date_format")
    if not pattern or not date_format:
        return [], "The dates in these headings could not be read."
    try:
        raw = [re.search(pattern, column).group(1) for column in columns]
        dates = pd.to_datetime(pd.Series(raw), format=date_format, errors="raise")
    except Exception:
        return [], "The dates in these headings could not be read."
    return list(dates), None


def _group_label(group: dict, columns: list[str]) -> str:
    """A heading for the group: its first column with the period blanked out."""
    key = group.get("key") or {}
    if key.get("target") == "period_start" and key.get("pattern"):
        match = re.search(key["pattern"], columns[0])
        if match:
            return columns[0][: match.start(1)] + "‹period›" + columns[0][match.end(1) :]
    if len(columns) > 1:
        return f"{columns[0]} … {columns[-1]}"
    return columns[0]


def _group_entry(entry_id: str, group: dict, columns: list[str], samples: dict) -> dict:
    keys, problem = _read_keys(group, columns)
    kind = "period" if (group.get("key") or {}).get("target") == "period_start" else "store"
    settings = {name: group[name] for name in ("select", "key", "labels", "period_type") if group.get(name)}
    if kind == "period" and keys and not settings.get("period_type"):
        settings["period_type"] = _period_type_from_dates(keys) or "month"

    readings = [
        {
            "column": column,
            "readsAs": key.date().isoformat() if kind == "period" else key,
            "sample": (samples.get(column) or [None])[0],
        }
        for column, key in list(zip(columns, keys))[:READINGS_SHOWN]
    ]
    return {
        "id": entry_id,
        "kind": kind,
        "label": _group_label(group, columns),
        "columns": columns,
        "group": settings,
        "readings": readings,
        "first": readings[0]["readsAs"] if kind == "period" and readings else None,
        "last": max(keys).date().isoformat() if kind == "period" and keys else None,
        "problem": problem,
        "meltGroupId": None,
        "field": None,
    }


def _detected_settings(detected: dict) -> dict:
    """A detected group (column_profile) as the contract's melt-group settings."""
    if detected["kind"] == "period":
        return {
            "select": {"kind": "pattern", "pattern": detected["select_pattern"]},
            "key": {
                "target": "period_start",
                "pattern": detected["key_pattern"],
                **({"date_format": detected["date_format"]} if detected.get("date_format") else {}),
            },
            **({"period_type": detected["period_type"]} if detected.get("period_type") else {}),
        }
    # A run of outlet codes is picked by the columns either side of it, so an
    # outlet added next month is picked up too. A run at the very start of the
    # file has nothing before it, so its columns are named instead.
    if detected.get("after"):
        select = {"kind": "between", "after": detected["after"]}
        if detected.get("before"):
            select["before"] = detected["before"]
    else:
        select = {"kind": "columns", "columns": detected["columns"]}
    return {"select": select, "key": {"target": "store_code"}}


def column_groups(columns: List[str], contract: Dict[str, Any], samples: Dict[str, list]) -> List[Dict[str, Any]]:
    """
    Every repeated column group the reviewer can choose as the source of a
    measure -- one row per period or per outlet -- with what it fills now.

    The groups layout detection finds (column_profile.review_column_groups),
    joined to the contract's own melt groups by the columns they select: a
    match takes the contract's settings, since the reviewer may have edited
    them. A contract group nothing detected is listed as it stands, so it can
    still be seen and taken off.
    """
    current = read_contract(contract)
    selected = mapping_contract.group_columns(current, columns)
    by_columns = {tuple(cols): group for group in current.get("melt_groups") or [] if (cols := selected.get(group["id"]))}

    entries = []
    for index, detected in enumerate(review_column_groups(columns)):
        group = by_columns.pop(tuple(detected["columns"]), None)
        entry = _group_entry(f"detected-{index}", group or _detected_settings(detected), detected["columns"], samples)
        if group:
            entry["meltGroupId"], entry["field"] = group["id"], group.get("value_target")
        entries.append(entry)

    for cols, group in by_columns.items():
        entry = _group_entry(f"melt-{group['id']}", group, list(cols), samples)
        entry["meltGroupId"], entry["field"] = group["id"], group.get("value_target")
        entries.append(entry)
    return entries


def envelope_to_packet(
    fingerprint: str, envelope: Dict[str, Any], state: str
) -> Dict[str, Any]:
    """Normalise a stored contract envelope into the review shape."""
    columns = envelope.get("raw_columns") or []
    confirmed = state == "confirmed"

    stored = read_contract(envelope.get("contract") or {})
    if confirmed:
        # Approved before the review flag existed: someone signed it off.
        for entry in [*stored.get("fields", {}).values(), *stored.get("melt_groups", [])]:
            entry.setdefault("reviewed", True)
    contract = validate_contract(
        stored, columns, envelope.get("target_schema") or BUSINESS_COLUMNS,
        trust_review=True, samples=validation_values(envelope),
    )
    rules = contract_to_rules(contract, reviewed_default=confirmed, columns=columns)

    return {
        "mappingId": fingerprint,
        "fingerprint": fingerprint,
        "kind": "existing" if confirmed else "proposed",
        "state": state,
        # A proposal has no name until someone approves it under one; showing
        # the fingerprint there would read as a name and it is not one.
        "name": envelope.get("name"),
        "vendor": envelope.get("vendor"),
        # The customer whose retailers this mapping's sales land on. None on a
        # proposal, and on a mapping approved before customers existed (only
        # its free-text vendor is known); either is linked at approval.
        "customerId": envelope.get("customer_id"),
        "customerName": envelope.get("customer_name"),
        "filename": envelope.get("example_file"),
        # The name the file was uploaded under, which is what a person
        # recognises a proposal by before it has a name of its own.
        "sourceFilename": envelope.get("source_filename"),
        "retailerFamily": None,
        "version": envelope.get("version"),
        # Which model proposed this mapping (recorded by generate_mapping), so
        # the review can say so once instead of naming a model throughout.
        "proposedBy": {"provider": envelope.get("provider"), "model": envelope.get("model")},
        "columns": columns,
        "columnSamples": envelope.get("column_samples") or {},
        # The first data rows lined up by column (older proposals have none;
        # testing the mapping returns them).
        "headRows": envelope.get("head_rows") or [],
        # Each column's distinct values -- all of them when there are few, an
        # even spread otherwise (column_profile) -- and how many there are, so
        # the screen can say which rows a rule sends where.
        "columnValues": {
            column: {"values": entry.get("values") or [], "distinct": entry.get("distinct", len(entry.get("values") or []))}
            for column, entry in (envelope.get("column_profile") or {}).items()
        },
        # The fields a reviewer may point a column at. Sent with the mapping
        # rather than hardcoded in the UI, so the dropdown cannot offer a field
        # whose source is fixed (the file's name, the period's end and label).
        "targetFields": list(DECIDABLE_FIELDS),
        # Sent alongside requiredMissing so the review screen can recheck the
        # requirement against edits in progress, instead of only knowing what
        # was missing at load.
        "requiredFields": REQUIRED_TARGET_FIELDS,
        # What the review screen tracks coverage against. Sent with the mapping
        # so the checklist cannot drift from what the contract can express.
        "coverageFields": CORE_TARGET_FIELDS,
        "periodDerivedFields": PERIOD_DERIVED_FIELDS,
        "rules": rules,
        # The file's repeated column groups (one column per period or per
        # outlet), which the reviewer can choose as a measure's source.
        "columnGroups": column_groups(columns, contract, envelope.get("column_samples") or {}),
        "measureFields": list(mapping_contract.MEASURE_FIELDS),
        **_meta(rules, columns),
        # The proposal's checks, run on the whole example file. The review
        # screen shows the failures first, with their evidence.
        "checks": envelope.get("checks") or [],
        # What layout detection found in the example file, and the
        # instructions the contract gives the transformation besides its
        # fields: where the data sits, whether rows roll up.
        "layout": envelope.get("layout") or {},
        "instructions": {
            "layout": contract.get("layout"),
            "aggregate": contract.get("aggregate"),
        },
        # Every product code in the example file, for the review screen's
        # code table (mapping_checks.sku_codes).
        "skuCodes": envelope.get("sku_codes") or [],
        "warnings": contract.get("warnings") or [],
        "editable": True,
        "validated": confirmed,
        "validatedAt": envelope.get("confirmed_at"),
    }
