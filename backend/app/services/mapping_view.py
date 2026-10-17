"""Present GCS mapping contracts in the shape used by the review screen."""

from typing import Any, Dict, List

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import mapping_contract
from app.services.mapping_contract import (
    DECIDABLE_FIELDS,
    REQUIRED_FIELDS,
    resolve_selector,
    upgrade,
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
    if status == "derived" and target == "period_type":
        return "Read from the period column headers"
    if status == "mapped" and entry.get("melt_group") in groups:
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
    current = upgrade(contract)
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
    legacy_groups: List[Dict[str, Any]] = []

    for rule in rules:
        target = rule.get("targetField")
        if not target or rule.get("editable", True):
            continue
        group = rule.get("meltGroup")
        if group and "target_field" in group:
            # A rule from a version 1 review screen, still carrying the old
            # group shape; upgraded with the rest of the contract below.
            legacy_groups.append(group)
            continue
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

    if legacy_groups:
        upgraded = upgrade({"melt_groups": legacy_groups})
        for group in upgraded["melt_groups"]:
            groups[group["id"]] = group
        for target, entry in upgraded["fields"].items():
            fields.setdefault(target, entry)

    return {
        "version": mapping_contract.CONTRACT_VERSION,
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


def envelope_to_packet(
    fingerprint: str, envelope: Dict[str, Any], state: str
) -> Dict[str, Any]:
    """Normalise a stored contract envelope into the review shape."""
    columns = envelope.get("raw_columns") or []
    confirmed = state == "confirmed"

    stored = upgrade(envelope.get("contract") or {})
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
        "filename": envelope.get("example_file"),
        "retailerFamily": None,
        "version": envelope.get("version"),
        "columns": columns,
        "columnSamples": envelope.get("column_samples") or {},
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
            "dataSource": contract.get("data_source"),
        },
        # Every product code in the example file, for the review screen's
        # code table (mapping_checks.sku_codes).
        "skuCodes": envelope.get("sku_codes") or [],
        "contractFormat": 2 if mapping_contract.is_v2(envelope.get("contract")) else 1,
        "warnings": contract.get("warnings") or [],
        "editable": True,
        "validated": confirmed,
        "validatedAt": envelope.get("confirmed_at"),
    }
