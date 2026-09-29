"""Dry-run or import an already-clean historical sell-out workbook."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.schemas.sellout import BUSINESS_COLUMNS  # noqa: E402
from app.services import apply_contract, sellout_service, sql  # noqa: E402
from app.services.validation_service import validate_mapped_dataframe  # noqa: E402


def prepare_workbook(path: Path):
    dataframe = apply_contract.read_source_dataframe(path.name, path.read_bytes())
    missing = [column for column in BUSINESS_COLUMNS if column not in dataframe.columns]
    if missing:
        raise ValueError(f"Clean workbook is missing required business columns: {missing}")

    validation = validate_mapped_dataframe(dataframe[BUSINESS_COLUMNS])
    if validation["total_rejected"]:
        raise ValueError(validation["rejection_summary"])

    valid_rows = validation["valid_df"]
    return valid_rows, sellout_service.summarize_clean_rows(valid_rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a canonical sell-out workbook and optionally load it "
            "directly into Cloud SQL without invoking mapping generation."
        )
    )
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Write the validated rows to Cloud SQL. The default is a dry run.",
    )
    parser.add_argument(
        "--expect-stored",
        type=int,
        help="Required safety check for --commit; the consolidated row count must match.",
    )
    parser.add_argument(
        "--data-source",
        default="pipeline",
        help="Lineage value stored in sellout.data_source (default: pipeline).",
    )
    args = parser.parse_args()

    path = args.workbook.resolve()
    if not path.is_file():
        parser.error(f"Workbook not found: {path}")

    try:
        valid_rows, summary = prepare_workbook(path)
    except Exception as exc:
        parser.error(str(exc))

    output = {"mode": "commit" if args.commit else "dry-run", **summary}
    print(json.dumps(output, indent=2, default=str))

    if not args.commit:
        print("Dry run only: Cloud SQL was not changed.")
        return 0

    if args.expect_stored is None:
        parser.error("--expect-stored is required with --commit")
    if summary["rows_stored"] != args.expect_stored:
        parser.error(
            f"Expected {args.expect_stored} stored rows, "
            f"but the workbook produces {summary['rows_stored']}."
        )

    try:
        result = sellout_service.load_clean_rows(
            valid_rows,
            data_source=args.data_source,
        )
    finally:
        sql.close_database()
    print(json.dumps({"database_result": result}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
