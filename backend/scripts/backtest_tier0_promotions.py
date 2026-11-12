"""
Backtest the promotion-adjusted Tier 0 against 2026 actuals, before the
formula is locked into BigQuery.

Tier 0 = 0.5 x same month last year + 0.5 x the 3-month run-rate, and each of
those months carries the official promotions that ran in it. The adjusted
Tier 0 takes each source month's promotions out (divides it by 1 + its
uplift), then puts the target month's own official promotions back in:

    adjusted = 0.5 x LY / (1 + u_ly) x (1 + u_target)
             + 0.5 x mean(month / (1 + u_month) over the run-rate months) x (1 + u_target)

A month's uplift u is every official promotion touching the customer's
offline stores for the SKU in that month, vouchers left out, each at its
uplift x the share of the month it runs; several promotions add up. A target
month with no promotion keeps today's Tier 0 (last year's promotions are
carried forward when nothing is planned).

Uplifts are worked out the way Promotion Uplift Settings does
(promo_anchor_versions: the averaged value for the anchor version in effect
in that month, else earlier versions, else the placeholder rule), but only
from moments up to each origin month, so a test month never measures itself.

Reads only: the SELECT inside bigquery/views/011_create_validation_tier0_components_view.sql
(nothing is created in BigQuery) and, from Cloud SQL, promotions, their stores
and SKUs, the moments, anchors and mechanic discounts. Needs credentials, so it
is a manual check, not a pytest (the maths is tested in
tests/test_backtest_tier0_promotions.py).

Run from backend/ with the venv active:

    python scripts/backtest_tier0_promotions.py --dry-run     # BigQuery bytes only
    python scripts/backtest_tier0_promotions.py               # writes scripts/out/tier0_promo_backtest.csv
"""

import argparse
import sys
from datetime import date
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.scenario.tier0_split import month_uplift
from app.services.scenario.tier0_split import split as adjusted_tier0
from app.services.settings import promo_anchor_versions as versions

VIEW_SQL = Path(__file__).resolve().parents[2] / "bigquery" / "views" / "011_create_validation_tier0_components_view.sql"
LOCATION = "asia-southeast1"
OUT = Path(__file__).resolve().parent / "out" / "tier0_promo_backtest.csv"
# The guard: a source month's uplift is taken out only at these levels, and
# the adjusted value stays within Tier 0 x (1 +/- GUARD_CAP).
GUARD_LEVELS = {versions.ANCHOR, versions.MEASURED}
GUARD_CAP = 0.35


# ============================================================
# PURE MATHS (the shared ones are in app/services/scenario/tier0_split.py)
# ============================================================


def capped(adjusted: float, tier0: float, limit: float) -> float:
    """The adjusted value kept within tier0 x (1 +/- limit)."""

    return min(max(adjusted, tier0 * (1 - limit)), tier0 * (1 + limit))


def scores(rows: list[dict], column: str) -> dict:
    """WAPE (total error / total actual), bias (total over or under / total actual) and mean sMAPE, in %."""

    actual = sum(row["actual"] for row in rows)
    error = sum(abs(row[column] - row["actual"]) for row in rows)
    signed = sum(row[column] - row["actual"] for row in rows)
    smapes = [
        2 * abs(row[column] - row["actual"]) / (abs(row["actual"]) + abs(row[column])) * 100
        for row in rows
        if abs(row["actual"]) + abs(row[column]) > 0
    ]
    return {
        "cells": len(rows),
        "wape": error / actual * 100 if actual else None,
        "bias": signed / actual * 100 if actual else None,
        "smape": mean(smapes) if smapes else None,
    }


# ============================================================
# READS (BigQuery: view 011's SELECT; Cloud SQL: SELECTs only)
# ============================================================


def _view_select() -> str:
    sql = VIEW_SQL.read_text()
    # Wrapped in a sub-query below, so the statement's closing ';' goes.
    return sql[sql.index(" AS\nWITH params AS") + len(" AS\n"):].rstrip().rstrip(";")


def _tier0_query(origin_from: date, max_horizon: int) -> str:
    # Past origins only: the view keeps a past origin's targets only where an actual exists.
    return (
        f"SELECT * FROM ({_view_select()})\n"
        f"WHERE origin_month >= DATE '{origin_from.isoformat()}'\n"
        f"  AND horizon BETWEEN 1 AND {int(max_horizon)}\n"
        f"  AND actual_quantity_cartons IS NOT NULL"
    )


def _bigquery_rows(origin_from: date, max_horizon: int, dry_run: bool) -> list[dict] | None:
    from google.cloud import bigquery

    from app.services.bigquery import get_bigquery_client

    client = get_bigquery_client()
    if dry_run:
        config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        for name, sql in (("view 011 SELECT", _tier0_query(origin_from, max_horizon)), ("run-rate history", _history_query(origin_from))):
            job = client.query(sql, job_config=config, location=LOCATION)
            print(f"Dry run, {name}: would scan {job.total_bytes_processed / 1e6:,.1f} MB.")
        return None
    job = client.query(_tier0_query(origin_from, max_horizon), location=LOCATION)
    return [dict(row.items()) for row in job.result()]


def _history_query(origin_from: date) -> str:
    # Each series' monthly cartons, for the run-rate months' own units.
    return (
        "SELECT customer_id, sku, month_year, quantity_cartons\n"
        "FROM `aire-data.aireos_forecast_validation_sg.fc_training_input`\n"
        f"WHERE month_year >= DATE_SUB(DATE '{origin_from.isoformat()}', INTERVAL 15 MONTH)"
    )


def _history(origin_from: date) -> dict[tuple[int, str], dict[date, float]]:
    from app.services.bigquery import get_bigquery_client

    rows = get_bigquery_client().query(_history_query(origin_from), location=LOCATION).result()
    history: dict[tuple[int, str], dict[date, float]] = {}
    for row in rows:
        history.setdefault((row["customer_id"], row["sku"]), {})[row["month_year"]] = float(row["quantity_cartons"])
    return history


def _cloud_sql_inputs() -> dict:
    from sqlalchemy import text

    from app.services.settings import common, promo_moments, promo_uplifts

    with common.read_connection() as conn:
        promotions = promo_moments._offline_promotions(conn)
        moments = [
            dict(row) for row in conn.execute(
                text(
                    """
                    SELECT
                        customer_id,
                        sku,
                        month,
                        promotion_id,
                        mechanic_key,
                        mechanic_label,
                        units

                    FROM promo_moment_calc

                    WHERE
                        NOT planned
                    """
                )
            ).mappings().all()
        ]
        return {
            "promotions": promotions,
            "moments": [{**m, "units": float(m["units"])} for m in moments],
            "sku_ranges": promo_moments.sku_ranges(conn),
            "anchor_rows": promo_uplifts._anchor_rows(conn),
            "discounts": promo_uplifts.mechanic_discounts(conn),
        }


# ============================================================
# THE BACKTEST
# ============================================================


def _uplift_lookup(inputs: dict, anchor_for, discount_for):
    """uplift_for(customer_id, sku, origin) -> (mechanic_key, month) -> choose_uplift, from moments up to origin."""

    cache: dict[tuple, dict] = {}

    def measured_for(customer_id: int, origin: date) -> dict[str, list[dict]]:
        key = (customer_id, origin)
        if key not in cache:
            known = [m for m in inputs["moments"] if m["customer_id"] == customer_id and m["month"] <= origin]
            by_sku: dict[str, list[dict]] = {}
            for moment in versions.measure_by_version(known, inputs["sku_ranges"], anchor_for):
                by_sku.setdefault(moment["sku"], []).append(moment)
            cache[key] = by_sku
        return cache[key]

    def uplift_for(customer_id: int, sku: str, origin: date):
        measured = measured_for(customer_id, origin).get(sku, [])
        sku_range = inputs["sku_ranges"].get(sku)

        def chosen(mechanic_key: str, month: date) -> dict:
            version = anchor_for(customer_id, sku_range, month)
            return versions.choose_uplift(measured, mechanic_key, version, discount_for)

        return chosen

    return uplift_for


def _names(carried: dict) -> str:
    return "; ".join(f"{p['mechanic']} x{p['share']:.2f}" for p in carried["promotions"])


def _cell(row: dict, history: dict, promotions: dict, uplift_for) -> dict:
    customer_id, sku, target = row["customer_id"], row["sku"], row["month_year"]
    chosen = uplift_for(customer_id, sku, row["origin_month"])

    def carried(month: date, allowed: set[str] | None = None) -> dict:
        return month_uplift(promotions.get((customer_id, sku), []), month, chosen, allowed)

    ly_month = date(target.year - 1, target.month, 1)
    ly_units = float(row["ly_cartons"]) if row["ly_cartons"] is not None else None
    ly = carried(ly_month) if ly_units is not None else None
    series = history.get((customer_id, sku), {})
    recent = [(month, series[month], carried(month)) for month in row["recent_months"] if month in series]
    planned = carried(target)
    has_target_promo = bool(planned["promotions"] or planned["missing"])
    target_uplift = planned["uplift"] if has_target_promo else None

    split = adjusted_tier0(
        ly_units,
        ly["uplift"] if ly else 0.0,
        [(units, info["uplift"]) for _, units, info in recent],
        target_uplift,
    )
    # The guard: only measured or anchor uplifts are taken out of the source months.
    guarded = adjusted_tier0(
        ly_units,
        carried(ly_month, GUARD_LEVELS)["uplift"] if ly else 0.0,
        [(units, carried(month, GUARD_LEVELS)["uplift"]) for month, units, _ in recent],
        target_uplift,
    )["adjusted"]
    sources = ([ly] if ly else []) + [info for _, _, info in recent]
    return {
        "customer_id": customer_id,
        "sku": sku,
        "origin_month": row["origin_month"],
        "month_year": target,
        "horizon": row["horizon"],
        "actual": float(row["actual_quantity_cartons"]),
        "view_tier0": float(row["sell_out_base"]),
        "tier0": split["tier0"],
        "baseline": split["baseline"],
        "carried": split["carried"],
        "adjusted": split["adjusted"],
        "guarded": guarded,
        "guarded_capped": capped(guarded, split["tier0"], GUARD_CAP),
        "target_promotions": _names(planned),
        "target_level": planned["level"],
        "source_levels": "; ".join(sorted({info["level"] for info in sources if info["level"]})),
        "ly_promotions": _names(ly) if ly else "",
        "rr_promotions": " | ".join(_names(info) for _, _, info in recent),
        "has_target_promo": has_target_promo,
        "combo": any(len(info["promotions"]) > 1 for info in sources + [planned]),
        "missing_uplift": "; ".join(sorted({m for info in sources + [planned] for m in info["missing"]})),
        "changed": abs(split["adjusted"] - split["tier0"]) >= 0.5,
    }


def _print_scores(title: str, rows: list[dict], columns: list[str]) -> None:
    print(f"\n{title}")
    if not rows:
        print("  no cells")
        return
    for column in columns:
        s = scores(rows, column)
        print(f"  {column:<18} cells {s['cells']:>5}   WAPE {s['wape']:6.1f}%   bias {s['bias']:+6.1f}%   sMAPE {s['smape']:6.1f}%")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--origin-from", default="2026-01-01", help="first origin month (YYYY-MM-01)")
    parser.add_argument("--max-horizon", type=int, default=3, help="months ahead to score (1 to 15)")
    parser.add_argument("--dry-run", action="store_true", help="only report the BigQuery bytes")
    args = parser.parse_args()
    origin_from = date.fromisoformat(args.origin_from)

    rows = _bigquery_rows(origin_from, args.max_horizon, args.dry_run)
    if rows is None:
        return

    history = _history(origin_from)
    inputs = _cloud_sql_inputs()
    anchor_for = versions.version_lookup(inputs["anchor_rows"])
    discount_for = lambda key: inputs["discounts"].get(key, {}).get("discount_pct")  # noqa: E731
    uplift_for = _uplift_lookup(inputs, anchor_for, discount_for)

    promotions: dict[tuple[int, str], list[dict]] = {}
    for promotion in inputs["promotions"]:
        promotions.setdefault((promotion["customer_id"], promotion["sku"]), []).append(promotion)

    cells = [_cell(row, history, promotions, uplift_for) for row in rows]

    # The recomputed Tier 0 must be the view's own before the adjustment means anything.
    off = [c for c in cells if abs(c["tier0"] - c["view_tier0"]) > 1.0]
    print(f"Cells: {len(cells)} ({len({(c['customer_id'], c['sku']) for c in cells})} series, "
          f"origins {min(c['origin_month'] for c in cells)} to {max(c['origin_month'] for c in cells)}).")
    print(f"Recomputed Tier 0 differs from the view by more than 1 carton in {len(off)} cells.")
    print(f"Target month has a promotion: {sum(c['has_target_promo'] for c in cells)}; "
          f"adjusted differs from Tier 0: {sum(c['changed'] for c in cells)}; "
          f"two or more promotions in a month: {sum(c['combo'] for c in cells)}; "
          f"a promotion with no uplift: {sum(bool(c['missing_uplift']) for c in cells)}.")

    columns = ["tier0", "adjusted", "guarded", "guarded_capped"]
    _print_scores("All cells", cells, columns)
    _print_scores("Cells the adjustment changes", [c for c in cells if c["changed"]], columns)
    _print_scores("Cells with two or more promotions in a month", [c for c in cells if c["combo"]], columns)
    for horizon in sorted({c["horizon"] for c in cells}):
        _print_scores(f"Horizon {horizon}", [c for c in cells if c["horizon"] == horizon], columns)
    for customer_id in sorted({c["customer_id"] for c in cells}):
        _print_scores(f"Customer {customer_id}", [c for c in cells if c["customer_id"] == customer_id], columns)

    import csv

    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(cells[0]))
        writer.writeheader()
        writer.writerows(cells)
    print(f"\nPer-cell rows: {OUT}")


if __name__ == "__main__":
    main()
