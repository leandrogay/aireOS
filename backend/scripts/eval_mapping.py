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

It also reports the checks the proposal failed and how many attempts it took.
Rerun it whenever the prompt (mapping_prompt.py) or a model changes.
Not part of pytest: it calls Vertex AI and costs money.

Run from backend/ with the venv active -- GCP_PROJECT_ID plus Google
credentials; the samples live in tests/fixtures/retailer_samples/ (git-ignored).
To compare models, run it once per MAPPING_MODEL:

    python scripts/eval_mapping.py
    python scripts/eval_mapping.py --only nhg_sap --show-diff
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from app.services import generate_mapping, layout_detection, mapping_checks, reference_contracts
from app.services.mapping_contract import DECIDABLE_FIELDS, group_columns, layout_instructions, validate_contract

SAMPLES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "retailer_samples"
PATTERNS = {
    "fairprice_monthly": "XEL_VENDORS_BRANDS_MONTH_*",
    "nhg_sap": "Aire*Sell*Out*",
    "sheng_siong_claim": "Claim_Sales_Summary_Report_*",
}


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


def evaluate(key: str, path: Path, show_diff: bool) -> dict:
    data = path.read_bytes()
    frame, layout = layout_detection.read_table(path.name, data)
    raw_columns = list(frame.columns)

    proposal = generate_mapping.generate_mapping_contract(
        path.name, frame, layout, exclude_examples=(key,)
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
    print(f"{key:<20} {agreed:>2}/{len(DECIDABLE_FIELDS)} fields agree   "
          f"attempts {proposal['attempts']}   failed checks: {', '.join(failed) or 'none'}")
    if show_diff:
        for target, diff in disagreements.items():
            print(f"    {target}: {json.dumps(diff)}")
    return {"key": key, "agreed": agreed, "total": len(DECIDABLE_FIELDS) + 1, "failed_checks": failed}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=sorted(PATTERNS), help="evaluate one retailer only")
    parser.add_argument("--show-diff", action="store_true", help="print every field that disagrees")
    args = parser.parse_args()

    print(f"model: {config.MAPPING_MODEL}")
    results = []
    for key, pattern in PATTERNS.items():
        if args.only and key != args.only:
            continue
        matches = sorted(SAMPLES.glob(pattern))
        if not matches:
            print(f"{key:<20} skipped: no file matching {pattern} in {SAMPLES}")
            continue
        results.append(evaluate(key, matches[0], args.show_diff))

    if results:
        agreed = sum(r["agreed"] for r in results)
        total = sum(r["total"] for r in results)
        print(f"overall: {agreed}/{total} fields agree ({agreed / total:.0%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
