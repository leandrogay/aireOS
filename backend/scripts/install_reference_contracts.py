"""
Store the hand-written reference contracts as confirmed mappings in GCS.

Each sample file in tests/fixtures/retailer_samples/ is fingerprinted, its
reference contract (app/services/reference_contracts.py) given the file's
layout, validated against its headers and checked against the file and the SKU
master (read-only), and -- with --write -- stored under
mappings/confirmed/<fingerprint>.json, so uploads of that layout map without
a model proposal. A confirmed mapping already stored for a layout is left
alone unless --replace is given; replacing archives it as a new version.

Without --write nothing in the bucket changes. Run from backend/ with the venv
active and the GCS settings in .env.backend:

    python scripts/install_reference_contracts.py            # preview
    python scripts/install_reference_contracts.py --write
"""

import argparse
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import column_profile, generate_mapping, layout_detection, mapping_checks, reference_contracts, storage
from app.services.mapping_contract import layout_instructions, validate_contract

SAMPLES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "retailer_samples"
PATTERNS = {
    "fairprice_monthly": "XEL_VENDORS_BRANDS_MONTH_*",
    "nhg_sap": "Aire*Sell*Out*",
    "sheng_siong_claim": "Claim_Sales_Summary_Report_*",
}


def envelope_for(key: str, path: Path) -> dict:
    frame, layout = layout_detection.read_table(path.name, path.read_bytes())
    columns = list(frame.columns)
    proposed = reference_contracts.reference_contract(key)
    proposed["layout"] = layout_instructions(layout)
    contract = validate_contract(proposed, columns, trust_review=True)
    contract.pop("warnings")
    checks = generate_mapping.check_contract(
        frame, layout, contract, path.name, generate_mapping.fetch_master_skus()
    )
    entry = reference_contracts.REFERENCE_CONTRACTS[key]
    return {
        "fingerprint": column_profile.fingerprint(columns),
        "raw_columns": columns,
        "column_samples": column_profile.column_samples(frame),
        "column_profile": column_profile.profile_columns(frame, layout),
        "layout": layout,
        "target_schema": BUSINESS_COLUMNS,
        "contract": contract,
        "proposal": contract,
        "checks": checks,
        "sku_codes": mapping_checks.sku_codes(frame, contract),
        "source_filename": path.name,
        "model": "reference contract",
        "name": entry["name"],
        "vendor": entry["vendor"],
        "version": 1,
        "edited_by_user": False,
        "reviewer_diff": [],
        "confirmed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="store the contracts in the bucket")
    parser.add_argument("--replace", action="store_true", help="replace a mapping already confirmed for the layout")
    args = parser.parse_args()

    for key, pattern in PATTERNS.items():
        matches = sorted(SAMPLES.glob(pattern))
        if not matches:
            print(f"{key:<20} skipped: no file matching {pattern} in {SAMPLES}")
            continue
        envelope = envelope_for(key, matches[0])
        failed = mapping_checks.failures(envelope["checks"])
        status = "checks pass" if not failed else f"FAILED: {', '.join(c['id'] for c in failed)}"
        print(f"{key:<20} fingerprint {envelope['fingerprint']}   {status}")
        if failed or not args.write:
            continue

        existing = storage.download_json(storage.confirmed_mapping_path(envelope["fingerprint"]))
        if existing and not args.replace:
            print(f"{'':<20} already confirmed as {existing.get('name')!r}; left alone (--replace to overwrite)")
            continue
        if existing:
            envelope["version"] = int(existing.get("version") or 1) + 1
        move = storage.move_pending_mapping_to_confirmed(envelope["fingerprint"], envelope)
        print(f"{'':<20} stored at {move['stored_at']}")

    if not args.write:
        print("\nPreview only: the bucket was not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
