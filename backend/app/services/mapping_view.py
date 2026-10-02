"""Present GCS mapping contracts in the shape used by the review screen."""

from typing import Any, Dict, List
from app.services.generate_mapping import normalize_targets

# The fields a mapping must fill for the ingest step to have anything to load.
REQUIRED_TARGET_FIELDS = [
    "retailer",
    "period_start",
    "period_end",
    "period_type",
    "store_code",
    "sku",
    "quantity_units",
    "revenue",
]

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


def contract_to_rules(
    contract: Dict[str, Any], reviewed_default: bool = False
) -> List[Dict[str, Any]]:
    """Flatten an LLM contract into one rule per target field.

    reviewed_default fills in "reviewed" for contracts stored before the flag
    existed. A mapping that was already approved passes True: someone signed
    it off, and asking them to re-confirm rows they already confirmed is the
    bug the flag was added to fix.
    """
    rules = []
    annotations = contract.get("annotations") or {}
    transformations = contract.get("transformations") or {}

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
                    transformations.get(target),
                    "mapped",
                    editable=True,
                    # A contract stored before confidence existed annotates
                    # nothing; "low" sends those rows to a reviewer rather than
                    # quietly presenting a year-old guess as certain.
                    confidence=annotation.get("confidence", "low"),
                    rationale=annotation.get("rationale", ""),
                    reviewed=annotation.get("reviewed", reviewed_default),
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
                reviewed=group.get("reviewed", reviewed_default),
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
    transformations: Dict[str, Dict[str, Any]] = {}
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
                    "reviewed": rule.get("reviewed") is True,
                }
                if isinstance(rule.get("transform"), dict):
                    transformations[target] = rule["transform"]
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
        "transformations": transformations,
    }


def _meta(rules: List[Dict[str, Any]], columns: List[str]) -> Dict[str, Any]:
    read = {
        column
        for rule in rules
        for column in rule.get("sourceColumns") or []
        if column
    }
    filled = {
        rule["targetField"] for rule in rules if rule.get("sourceColumn")
    }
    # A melt group fills the period fields from its column headers, so no rule
    # names them. Same rule as reviewIssues in the frontend's mappingReview.js.
    if any(rule.get("status") == "derived" for rule in rules):
        filled.update(PERIOD_DERIVED_FIELDS)
    return {
        "unmapped": [column for column in columns if column not in read],
        "requiredMissing": [
            field for field in REQUIRED_TARGET_FIELDS if field not in filled
        ],
    }


def required_missing_fields(contract: Dict[str, Any]) -> List[str]:
    """Required ingest targets a validated contract still cannot produce."""
    return _meta(contract_to_rules(contract), [])["requiredMissing"]


def envelope_to_packet(
    fingerprint: str, envelope: Dict[str, Any], state: str
) -> Dict[str, Any]:
    """Normalise a stored contract envelope into the review shape."""
    contract = envelope.get("contract") or {}
    columns = envelope.get("raw_columns") or []
    confirmed = state == "confirmed"
    rules = contract_to_rules(contract, reviewed_default=confirmed)

    # Keep each melt group attached to its rule so rules_to_contract can put it
    # back untouched when the user saves an edit to some other row.
    groups = iter(contract.get("melt_groups") or [])
    for rule in rules:
        if not rule["editable"]:
            rule["meltGroup"] = next(groups, None)

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


def builtin_packet() -> Dict[str, Any]:
    """Read-only packet describing the built-in mapping flow."""
    fields = list(dict.fromkeys(CORE_TARGET_FIELDS + REQUIRED_TARGET_FIELDS))
    rules = [
        _rule(
            field,
            ["built-in parser"],
            "built-in parser",
            None,
            "mapped",
            editable=False,
            confidence="high",
            rationale="Handled by built-in mapping logic.",
            reviewed=True,
        )
        for field in fields
    ]
    return {
        "mappingId": "builtin",
        "fingerprint": None,
        "kind": "builtin",
        "state": "builtin",
        "name": "Built-in mapping",
        "vendor": None,
        "filename": None,
        "retailerFamily": None,
        "columns": [],
        "columnSamples": {},
        "targetFields": fields,
        "requiredFields": REQUIRED_TARGET_FIELDS,
        "coverageFields": CORE_TARGET_FIELDS,
        "periodDerivedFields": PERIOD_DERIVED_FIELDS,
        "rules": rules,
        **_meta(rules, []),
        "warnings": [],
        "editable": False,
        "validated": True,
        "validatedAt": None,
    }
