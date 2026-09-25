"""
Refresh the P&L forecast shown on the Forecast page.

Rebuilds the actual rows in BQ_FORECAST_TABLE from the FairPrice sell-out
table, adds the next 12-month rolling run when a newer month is complete,
adds a frozen yearly baseline for every calendar year whose prior December
is complete and doesn't have one yet (all eligible years in one run -- so a
one-time backfill against years of existing history adds all of them at
once, not one per run), and fills predicted_quantity_units / predicted_revenue
for both (see app/services/pl_forecast.py for the formulas -- a yearly
baseline, once computed, is never recomputed by a later run of this script).
Then, unless --skip-inventory, also recomputes actual/predicted closing inventory and
recommended sell-in from inventory_metrics into BQ_INVENTORY_POSITION_TABLE
(see app/services/inventory_forecast.py).
Without --write it only previews: nothing in BigQuery changes and the
results are saved as CSVs under scripts/out/.

Run from backend/ with the venv active. BigQuery credentials come from
GOOGLE_APPLICATION_CREDENTIALS, same as the API:

    # first time: replace the mock placeholders in every run
    python scripts/refresh_forecast.py --recompute-all            # preview
    python scripts/refresh_forecast.py --recompute-all --write

    # after each new FairPrice upload
    python scripts/refresh_forecast.py --write

    # hand-set a promo uplift, like typing a P&L Building Blocks row
    python scripts/refresh_forecast.py --uplift bundle=0.25 --uplift regular=0.15
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import forecast_service

OUT_DIR = Path(__file__).resolve().parent / "out"


def _parse_uplifts(values: list[str]) -> dict[str, float]:
    uplifts = {}
    for value in values:
        promo_type, _, uplift = value.partition("=")
        if not uplift:
            raise SystemExit(f"--uplift expects PROMO=NUMBER, got {value!r}")
        uplifts[promo_type.strip()] = float(uplift)
    return uplifts


def _save_preview(result: dict) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    if not result["actual_changes"].empty:
        result["actual_changes"].to_csv(OUT_DIR / "actual_changes.csv", index=False)
        print("\nActual rows changed:")
        print(result["actual_changes"][["product_name", "month_year", "change"]].to_string(index=False))

    forecast = result["forecast"]
    if forecast.empty:
        return
    forecast.to_csv(OUT_DIR / "predicted_quantity_units.csv", index=False)
    print("\nPredicted units by run (summed across the whole run -- see predicted_quantity_units.csv for monthly):")
    # A rolling and a yearly run can share a forecast_generated_at date (see
    # forecasting_output_schema.sql) -- group by run_type too, or a pivot on
    # date alone would silently sum two unrelated runs into one column.
    print(forecast.pivot_table(index="product_name", columns=["run_type", "forecast_generated_at"],
                               values="predicted_quantity_units", aggfunc="sum").to_string())
    print(f"\nPreview CSVs saved in {OUT_DIR}")


def _save_inventory_preview(result: dict) -> None:
    positions = result["positions"]
    if positions.empty:
        return
    OUT_DIR.mkdir(exist_ok=True)
    positions.to_csv(OUT_DIR / "inventory_position.csv", index=False)
    print("\nInventory position (latest known + horizon months):")
    print(positions[["product_name", "customer_name", "month_year", "inventory_position",
                     "recommended_sell_in"]].to_string(index=False))
    print(f"\nPreview CSV saved in {OUT_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="MERGE the results into BigQuery")
    parser.add_argument("--skip-actuals", action="store_true",
                        help="don't rebuild actual rows from the sell-out table")
    parser.add_argument("--skip-yearly", action="store_true",
                        help="don't add or compute any new yearly baselines")
    parser.add_argument("--recompute-all", action="store_true",
                        help="recompute every run, not just the latest / new / blank ones")
    parser.add_argument("--uplift", action="append", default=[], metavar="PROMO=NUMBER",
                        help="override a promo uplift, e.g. --uplift bundle=0.25")
    parser.add_argument("--exclude-months", default="", metavar="YYYY-MM,...",
                        help="actual months the model should ignore")
    parser.add_argument("--skip-inventory", action="store_true",
                        help="don't refresh actual/predicted closing inventory or recommended sell-in")
    args = parser.parse_args()

    result = forecast_service.refresh_forecast(
        write=args.write,
        refresh_actuals=not args.skip_actuals,
        refresh_yearly=not args.skip_yearly,
        recompute_all=args.recompute_all,
        exclude_months={month.strip() for month in args.exclude_months.split(",") if month.strip()},
        uplift_override=_parse_uplifts(args.uplift),
    )
    print("\n".join(result["notes"]))
    _save_preview(result)

    if not args.skip_inventory:
        inventory_result = forecast_service.refresh_inventory_position(write=args.write)
        print("\n" + "\n".join(inventory_result["notes"]))
        _save_inventory_preview(inventory_result)

    if not args.write:
        print("\nPreview only -- add --write to update BigQuery.")


if __name__ == "__main__":
    main()
