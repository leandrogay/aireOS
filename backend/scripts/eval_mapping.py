"""
Score the model's mapping proposals against the reference contracts.

For each retailer sample file, asks the model (Gemini on Vertex AI) for a contract exactly as an upload
of a new layout would -- but with that retailer's own reference contract left
out of the examples, so the answer cannot be copied -- and compares it field by
field with the reference (app/services/reference_contracts.py):

  - status must match (mapped / derived / constant / not_available)
  - a mapped field must read the same column, or a melt group selecting the
    same columns with the same key
  - a constant must have the same value, a derived field the same source field
  - the sku field's product-code table must give every code the same master SKU
  - the monthly roll-up instruction must match

It also reports the checks the proposal failed, how many attempts it took,
anything validation dropped (a step or parameter the transformation does not
have), what the model flagged as unsupported, and -- by running both contracts
through the transformation -- whether the proposal loads the same units as
the reference does.
Rerun it whenever the prompt (mapping_prompt.py) or a model changes.
Not part of pytest: it calls Vertex AI and costs money.

Run from backend/ with the venv active -- GCP_PROJECT_ID plus Google
credentials; the samples live in tests/test_fixtures/ or
tests/fixtures/retailer_samples/ (both git-ignored).
To compare models, run it once per MAPPING_MODEL:

    python scripts/eval_mapping.py
    python scripts/eval_mapping.py --only nhg_sap --show-diff
    python scripts/eval_mapping.py --no-examples --show-diff     # no reference contracts shown at all
    python scripts/eval_mapping.py --file path/to/new_source.xlsx  # unseen file, no reference to score against
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from app.services import (
    apply_contract,
    generate_mapping,
    layout_detection,
    mapping_checks,
    reference_contracts,
    validation_service,
)
from app.services.mapping_contract import DECIDABLE_FIELDS, group_columns, layout_instructions, validate_contract

TESTS = Path(__file__).resolve().parents[1] / "tests"
SAMPLE_FOLDERS = [TESTS / "test_fixtures", TESTS / "fixtures" / "retailer_samples"]
PATTERNS = {
    "fairprice_monthly": "XEL_VENDORS_BRANDS_MONTH_*",
    "nhg_sap": "Aire*Sell*Out*",
    "sheng_siong_claim": "Claim_Sales_Summary_Report_*",
    "singhealth_er130": "XEL Jul26*",
    "prime_jkdc": "XEL Lifecare JKDC*Jul*",
    "pharmex_grid": "Inventory_Aug_2[0-9].xlsx",
    "prime_sales": "Prime - * - Sales report.xlsx",
}


def _sample_paths(pattern: str) -> list[Path]:
    return sorted(
        path for folder in SAMPLE_FOLDERS if folder.exists() for path in folder.rglob(pattern) if path.is_file()
    )


def _units_loaded(frame, layout, contract: dict, filename: str) -> float | str:
    """The units a contract loads from the file, or why the transformation could not run it."""
    try:
        rows = apply_contract.apply_contract(frame, contract, source_file=filename, layout=layout)
    except apply_contract.ContractApplicationError as error:
        return f"cannot run: {error}"
    validated = validation_service.validate_mapped_dataframe(rows)
    return round(float(validated["valid_df"]["quantity_units"].sum()), 2)


def _decision(contract: dict, columns: dict[str, list[str]], target: str) -> dict:
    """What a field's decision amounts to, comparable across two contracts."""
    entry = contract["fields"].get(target) or {"status": "not_available"}
    status = entry.get("status")
    if status == "mapped" and entry.get("melt_group"):
        group = next(g for g in contract["melt_groups"] if g["id"] == entry["melt_group"])
        role = "key" if group["key"]["target"] == target else "value"
        return {"status": status, "melted": sorted(columns.get(group["id"], [])), "role": role}
    if status == "mapped" and target == "sku":
        codes = {}
        for transform in entry.get("transforms") or []:
            if transform.get("type") == "value_map":
                codes.update(transform.get("values") or {})
        return {"status": status, "source": entry.get("source"), "codes": codes}
    if status == "mapped":
        return {"status": status, "source": entry.get("source")}
    if status == "constant":
        return {"status": status, "value": entry.get("value")}
    if status == "derived":
        return {"status": status, "from_field": entry.get("from_field")}
    return {"status": status}


def propose_unseen(path: Path) -> None:
    """
    Propose a contract for a file with no reference answer, with every example
    hidden, and print what the model decided and which checks it failed -- a
    stand-in for a data source nobody has mapped before.
    """
    frame, layout = layout_detection.read_table(path.name, path.read_bytes())
    proposal = generate_mapping.generate_mapping_contract(
        path.name, frame, layout, exclude_examples=tuple(reference_contracts.REFERENCE_CONTRACTS)
    )
    contract = proposal["contract"]
    columns = group_columns(contract, list(frame.columns))
    failed = mapping_checks.failures(proposal["checks"])
    print(f"{path.name}: attempts {proposal['attempts']}, failed checks: {', '.join(c['id'] for c in failed) or 'none'}")
    for target in DECIDABLE_FIELDS:
        print(f"    {target}: {json.dumps(_decision(contract, columns, target), default=str)}")
    print(f"    aggregate: {json.dumps(contract.get('aggregate'))}")
    for check in failed:
        print(f"    FAILED {check['id']}: {check['message']}")
    for warning in contract.get("warnings") or []:
        print(f"    DROPPED BY VALIDATION: {warning}")
    for item in contract.get("unsupported") or []:
        print(f"    FLAGGED UNSUPPORTED ({item.get('field') or 'file'}): {item['issue']}")
    print(f"    filters: {json.dumps(contract.get('filters'))}")
    print(f"    units loaded: {_units_loaded(frame, layout, contract, path.name)}")


def evaluate(key: str, path: Path, show_diff: bool, no_examples: bool) -> dict:
    data = path.read_bytes()
    frame, layout = layout_detection.read_table(path.name, data)
    raw_columns = list(frame.columns)

    # Cold start hides every reference, not just this retailer's own.
    hidden = tuple(reference_contracts.REFERENCE_CONTRACTS) if no_examples else (key,)
    proposal = generate_mapping.generate_mapping_contract(
        path.name, frame, layout, exclude_examples=hidden
    )
    proposed = proposal["contract"]
    reference = reference_contracts.reference_contract(key)
    reference["layout"] = layout_instructions(layout)
    reference = validate_contract(reference, raw_columns, trust_review=True)

    proposed_cols = group_columns(proposed, raw_columns)
    reference_cols = group_columns(reference, raw_columns)
    disagreements = {}
    for target in DECIDABLE_FIELDS:
        want = _decision(reference, reference_cols, target)
        got = _decision(proposed, proposed_cols, target)
        if want != got:
            disagreements[target] = {"reference": want, "proposed": got}

    if bool(proposed.get("aggregate")) != bool(reference.get("aggregate")):
        disagreements["aggregate"] = {"reference": reference.get("aggregate"), "proposed": proposed.get("aggregate")}
    failed = [check["id"] for check in mapping_checks.failures(proposal["checks"])]
    agreed = len(DECIDABLE_FIELDS) + 1 - len(disagreements)
    wanted = _units_loaded(frame, layout, reference, path.name)
    loaded = _units_loaded(frame, layout, proposed, path.name)
    print(f"{key:<20} {agreed:>2}/{len(DECIDABLE_FIELDS)} fields agree   "
          f"attempts {proposal['attempts']}   failed checks: {', '.join(failed) or 'none'}   "
          f"units loaded: {loaded} (reference {wanted})")
    for warning in proposed.get("warnings") or []:
        print(f"    DROPPED BY VALIDATION: {warning}")
    for item in proposed.get("unsupported") or []:
        print(f"    FLAGGED UNSUPPORTED ({item.get('field') or 'file'}): {item['issue']}")
    if show_diff:
        for target, diff in disagreements.items():
            print(f"    {target}: {json.dumps(diff)}")
    return {
        "key": key, "agreed": agreed, "total": len(DECIDABLE_FIELDS) + 1, "failed_checks": failed,
        "same_units": loaded == wanted,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=sorted(PATTERNS), help="evaluate one retailer only")
    parser.add_argument("--show-diff", action="store_true", help="print every field that disagrees")
    parser.add_argument("--no-examples", action="store_true",
                        help="cold start: show the model none of the reference contracts")
    parser.add_argument("--file", type=Path,
                        help="propose a contract for any file with no examples and no reference (a never-seen source)")
    args = parser.parse_args()

    print(f"model: {config.MAPPING_MODEL}")
    if args.file:
        propose_unseen(args.file)
        return 0
    results = []
    for key, pattern in PATTERNS.items():
        if args.only and key != args.only:
            continue
        matches = _sample_paths(pattern)
        if not matches:
            print(f"{key:<20} skipped: no file matching {pattern} in tests/test_fixtures")
            continue
        results.append(evaluate(key, matches[0], args.show_diff, args.no_examples))

    if results:
        agreed = sum(r["agreed"] for r in results)
        total = sum(r["total"] for r in results)
        print(f"overall: {agreed}/{total} fields agree ({agreed / total:.0%}); "
              f"{sum(r['same_units'] for r in results)}/{len(results)} proposals load the reference's units")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
