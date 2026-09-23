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
from app.services.generate_mapping import normalize_targets
from app.services.mapping_service import (
    FAIRPRICE_SOURCE_COLUMNS,
    FAIRPRICE_UNMAPPED_HEADERS,
    TARGET_SCHEMA as BUILTIN_TARGET_SCHEMA,
    build_fairprice_wide_rules,
)

BUILTIN_MAPPING_ID = "fairprice_wide_v1"

# What the builtin mapping is called wherever a mapping is named -- the review
# screen, the upload result, the history table. One string, so the three cannot
# drift into three different names for the same rule set.
BUILTIN_MAPPING_NAME = "FairPrice wide (built-in)"
BUILTIN_MAPPING_VENDOR = "Fairprice"

# The fields a mapping must fill for the ingest step to have anything to load.
REQUIRED_TARGET_FIELDS = ["sku", "quantity_units", "revenue", "period_start"]

# The business fields a reviewer is asked to account for, in the order the
# review screen lists them.
#
# Narrower than the contract's target schema, which also carries the measures
# (quantity_units, revenue) and the pipeline columns (source_file,
# period_label). Those are not decisions anyone makes in a review: the measures
# come from the melt groups, and the pipeline columns are written at ingest.
CORE_TARGET_FIELDS = [
    "retailer",
    "period_start",
    "period_end",
    "period_type",
    "store_code",
    "store_name",
    "store_format",
    "sku",
    "sku_range",
    "product_name",
    "size",
    "brand",
    "product_category",
    "uom",
    "pack_size",
]

# Fields a melt group fills by itself. apply_contract reads the period out of
# each period column's header, so no source column is ever chosen for these --
# a review that showed them as "unmapped" would be sending someone looking for
# a column that does not exist.
PERIOD_DERIVED_FIELDS = ["period_start", "period_end", "period_type"]


def _rule(
    target_field: str,
    source_columns: List[str],
    display: str,
    transform: Optional[str],
    status: str,
    editable: bool,
    confidence: str = "high",
    rationale: str = "",
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
    }


def contract_to_rules(contract: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten an LLM contract into one rule per target field."""
    rules = []
    annotations = contract.get("annotations") or {}

    # identity_mapping is {source: target-or-targets}; the review reads
    # target-first, so a column filling two fields becomes two rules pointing
    # at the same column.
    for source, value in (contract.get("identity_mapping") or {}).items():
        for target in normalize_targets(value):
            # Annotations are keyed by target field. Contracts written before
            # that keyed them by source column, so fall back to it.
            annotation = annotations.get(target) or annotations.get(source) or {}
            rules.append(
                _rule(
                    target,
                    [source],
                    source,
                    None,
                    "mapped",
                    editable=True,
                    # A contract stored before confidence existed annotates
                    # nothing; "low" sends those rows to a reviewer rather than
                    # quietly presenting a year-old guess as certain.
                    confidence=annotation.get("confidence", "low"),
                    rationale=annotation.get("rationale", ""),
                )
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
            _rule(
                target,
                columns,
                display,
                transform,
                "derived",
                editable=False,
                confidence=group.get("confidence", "low"),
                rationale=group.get("rationale", ""),
            )
        )

    return rules


def rules_to_contract(rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rebuild a contract from edited rules. Inverse of contract_to_rules.

    Melt groups are carried back verbatim from the rule that produced them,
    since the review screen never edits them. Only identity rows can move.
    """
    by_source: Dict[str, List[str]] = {}
    annotations: Dict[str, Dict[str, str]] = {}
    melt_groups: List[Dict[str, Any]] = []

    for rule in rules:
        target = rule.get("targetField")
        if not target:
            continue

        if rule.get("editable", True):
            source = (rule.get("sourceColumn") or "").strip()
            if source:
                targets = by_source.setdefault(source, [])
                if target not in targets:
                    targets.append(target)
                annotations[target] = {
                    "confidence": rule.get("confidence") or "low",
                    "rationale": rule.get("rationale") or "",
                }
            continue

        group = rule.get("meltGroup")
        if group:
            melt_groups.append(group)

    # A single target stays a plain string, so the common case stores exactly
    # what it always did and only a column that genuinely feeds several fields
    # carries a list.
    identity_mapping: Dict[str, Any] = {
        source: targets[0] if len(targets) == 1 else targets
        for source, targets in by_source.items()
    }

    return {
        "identity_mapping": identity_mapping,
        "melt_groups": melt_groups,
        "annotations": annotations,
    }


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
            # Nothing here was inferred: these rules are hand-written Python
            # matched by an exact header recogniser.
            confidence="high",
            rationale="Built-in rule, matched on the exact FairPrice header layout.",
        )
        for rule in build_fairprice_wide_rules()
    ]

    return {
        "mappingId": BUILTIN_MAPPING_ID,
        "fingerprint": None,
        "kind": "catalog",
        "state": "builtin",
        "name": BUILTIN_MAPPING_NAME,
        "vendor": BUILTIN_MAPPING_VENDOR,
        "filename": None,
        "retailerFamily": "fairprice",
        "columns": FAIRPRICE_SOURCE_COLUMNS,
        "columnSamples": {},
        "targetFields": BUILTIN_TARGET_SCHEMA,
        "requiredFields": REQUIRED_TARGET_FIELDS,
        "coverageFields": CORE_TARGET_FIELDS,
        "periodDerivedFields": PERIOD_DERIVED_FIELDS,
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
        # A proposal has no name until someone approves it under one; showing
        # the fingerprint there would read as a name and it is not one.
        "name": envelope.get("name"),
        "vendor": envelope.get("vendor"),
        "filename": envelope.get("example_file"),
        "retailerFamily": None,
        "columns": columns,
        "columnSamples": envelope.get("column_samples") or {},
        # The fields a reviewer may repoint a column at. Sent with the mapping
        # rather than hardcoded in the UI, so the dropdown cannot offer a field
        # this contract will be validated against and rejected for.
        "targetFields": envelope.get("target_schema") or [],
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
        "warnings": contract.get("warnings") or [],
        "editable": True,
        "validated": confirmed,
        "validatedAt": envelope.get("confirmed_at"),
    }
