"""
One shape for two kinds of mapping.

The app has two sources of mapping truth that look nothing alike:

  - AO1-2's deterministic FairPrice mapping, written as Python in
    mapping_service.apply_existing_mapping and described declaratively by
    FAIRPRICE_WIDE_FIELD_MAP.
  - AO1-3's LLM contracts, a JSON packet of identity_mapping + melt_groups
    stored in the bucket and keyed by header fingerprint.

Neither converts cleanly into the other -- a contract cannot express "retailer
is FPON mapped to fairprice_online", and a Python transform cannot be melted by
a regex. So instead of forcing one into the other, both are normalised here
into the same review shape: one rule per target field, saying where that field
comes from and what happens on the way.
"""

from typing import Any, Dict, List, Optional

from app.services.mapping_service import (
    FAIRPRICE_SOURCE_COLUMNS,
    FAIRPRICE_UNMAPPED_HEADERS,
    build_fairprice_wide_rules,
)

BUILTIN_MAPPING_ID = "fairprice_wide_v1"

# The fields a mapping must fill for the ingest step to have anything to load.
REQUIRED_TARGET_FIELDS = ["sku", "quantity_units", "revenue", "period_start"]


def _rule(
    target_field: str,
    source_columns: List[str],
    display: str,
    transform: Optional[str],
    status: str,
    editable: bool,
) -> Dict[str, Any]:
    return {
        "targetField": target_field,
        "sourceColumn": display,
        "sourceColumns": source_columns,
        "transform": transform,
        "status": status,
        "editable": editable,
    }


def contract_to_rules(contract: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten an LLM contract into one rule per target field."""
    rules = []

    # identity_mapping is {source: target}; the review reads target-first.
    for source, target in (contract.get("identity_mapping") or {}).items():
        rules.append(
            _rule(target, [source], source, None, "mapped", editable=True)
        )

    for group in contract.get("melt_groups") or []:
        columns = group.get("columns") or []
        target = group.get("target_field")
        if not target:
            continue

        # A melt group reads many columns at once, so there is no single source
        # to swap -- the group is edited by changing the contract, not a cell.
        display = (
            f"{columns[0]} (+{len(columns) - 1} more period columns)"
            if len(columns) > 1
            else (columns[0] if columns else "")
        )
        transform = (
            f"melt {len(columns)} period columns; "
            f"period from /{group.get('period_extract_regex')}/ "
            f"parsed as {group.get('date_format')}"
        )
        rules.append(
            _rule(target, columns, display, transform, "derived", editable=False)
        )

    return rules


def rules_to_contract(rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rebuild a contract from edited rules. Inverse of contract_to_rules.

    Melt groups are carried back verbatim from the rule that produced them,
    since the review screen never edits them. Only identity rows can move.
    """
    identity_mapping: Dict[str, str] = {}
    melt_groups: List[Dict[str, Any]] = []

    for rule in rules:
        target = rule.get("targetField")
        if not target:
            continue

        if rule.get("editable", True):
            source = (rule.get("sourceColumn") or "").strip()
            if source:
                identity_mapping[source] = target
            continue

        group = rule.get("meltGroup")
        if group:
            melt_groups.append(group)

    return {"identity_mapping": identity_mapping, "melt_groups": melt_groups}


def _meta(rules: List[Dict[str, Any]], columns: List[str]) -> Dict[str, Any]:
    read = {
        column
        for rule in rules
        for column in rule.get("sourceColumns") or []
        if column
    }
    return {
        "unmapped": [column for column in columns if column not in read],
        "requiredMissing": [
            field
            for field in REQUIRED_TARGET_FIELDS
            if not any(
                rule["targetField"] == field and rule.get("sourceColumn")
                for rule in rules
            )
        ],
    }


def builtin_packet() -> Dict[str, Any]:
    """The AO1-2 FairPrice mapping, presented as a read-only rule set.

    Every rule here is executed by hardcoded Python in apply_existing_mapping,
    so repointing a source column in the UI would change the display and not
    the behaviour. The whole packet is therefore locked.
    """
    rules = [
        _rule(
            rule["targetField"],
            [part.strip() for part in rule["sourceColumn"].split(" + ")],
            rule["sourceColumn"],
            rule["transform"],
            rule["status"],
            editable=False,
        )
        for rule in build_fairprice_wide_rules()
    ]

    return {
        "mappingId": BUILTIN_MAPPING_ID,
        "fingerprint": None,
        "kind": "catalog",
        "state": "builtin",
        "filename": None,
        "retailerFamily": "fairprice",
        "columns": FAIRPRICE_SOURCE_COLUMNS,
        "rules": rules,
        "unmapped": FAIRPRICE_UNMAPPED_HEADERS,
        "requiredMissing": [],
        "warnings": [],
        "editable": False,
        "validated": True,
        "validatedAt": None,
    }


def envelope_to_packet(
    fingerprint: str, envelope: Dict[str, Any], state: str
) -> Dict[str, Any]:
    """Normalise a stored contract envelope into the review shape."""
    contract = envelope.get("contract") or {}
    columns = envelope.get("raw_columns") or []
    rules = contract_to_rules(contract)

    # Keep each melt group attached to its rule so rules_to_contract can put it
    # back untouched when the user saves an edit to some other row.
    groups = iter(contract.get("melt_groups") or [])
    for rule in rules:
        if not rule["editable"]:
            rule["meltGroup"] = next(groups, None)

    confirmed = state == "confirmed"

    return {
        "mappingId": fingerprint,
        "fingerprint": fingerprint,
        "kind": "existing" if confirmed else "proposed",
        "state": state,
        "filename": envelope.get("example_file"),
        "retailerFamily": None,
        "columns": columns,
        "rules": rules,
        **_meta(rules, columns),
        "warnings": contract.get("warnings") or [],
        "editable": True,
        "validated": confirmed,
        "validatedAt": envelope.get("confirmed_at"),
    }
