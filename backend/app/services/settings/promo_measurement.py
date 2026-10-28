import json
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from google.api_core.exceptions import NotFound
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services import bigquery as bq
from app.services.sellout_service import EFFECTIVE_SELLOUT_CTE
from app.services.settings import common
from app.services.settings import promo_measurement_rules as mrules
from app.services.settings import promo_uplift_rules as rules
from app.services.settings import promo_uplifts as uplifts


# The promotion uplift measurement job: measures each mechanic's uplift from
# sales data and keeps Promotion Uplift Settings up to date by itself
# (plan and reasoning: docs/forecasting.md, Part E). Run daily by the Cloud
# Run Job scripts/measure_promo_uplifts.py and by the settings page's
# Re-measure button.
#
# Reads: BigQuery fc_training_input and fc_backtest_forecasts (read-only);
# Cloud SQL promotions, stores, sell-out and the settings tables.
# Writes (Cloud SQL only, one transaction, append-only): 'measured' rows in
# promo_uplift_settings, and the 008 tables (runs, results, notes).
# The maths is pure and lives in promo_measurement_rules.py.

logger = logging.getLogger(__name__)


# ============================================================
# Custom Exceptions
# ============================================================


class MeasurementRunningError(Exception):
    pass


class NoteNotFoundError(Exception):
    pass


class NoteConflictError(Exception):
    pass


# ============================================================
# Constants
# ============================================================

TRIGGERS = ("scheduler", "button")
CHANGED_BY = "measurement"

# Bump when the maths changes, so the next run measures again even if no
# input changed.
CODE_VERSION = "2026-10-28"

# The Cloud Scheduler trigger runs the job daily at this hour, Singapore time
# (docs/promo-uplift-runbook.md). Only used to show "next due".
SCHEDULE_HOUR_SGT = 4
_SINGAPORE = timezone(timedelta(hours=8))

# Postgres advisory lock id: only one run at a time.
_LOCK_KEY = 4_830_281

# Used when promo_measurement_config has no current row.
DEFAULT_CONFIG = {
    "starting_weight": 3.0,
    "min_exposure": 0.23,
    "reask_points": 2.0,
    "stale_days": 100,
    "trend_min_months": 6,
    "backtest_tolerance_points": 1.0,
}

# A value and the one a person typed count as the same below this many points.
_SAME_VALUE_POINTS = 0.05

# Database bounds of promo_uplift_settings.uplift_pct.
_MIN_UPLIFT, _MAX_UPLIFT = -90.0, 300.0

SUCCESS_STATUSES = ("succeeded", "succeeded_with_warnings")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _one_decimal(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def _num(value) -> float | None:
    return float(value) if value is not None else None


# ============================================================
# READS: BIGQUERY (read-only)
# ============================================================


def _dataset() -> str:
    return bq._catalog_dataset()


def _read_training() -> list[dict]:
    client = bq.get_bigquery_client()
    query = f"""
        SELECT customer_id, sku, month_year, quantity_cartons
        FROM `{_dataset()}.fc_training_input`
    """
    return [dict(row) for row in client.query(query).result()]


def _read_backtest_errors() -> tuple[dict | None, list[str]]:
    """
    {(customer_id, sku, month): error %} from the latest run's ARIMA_PLUS
    backtest month forecasts (pipeline step 2c), averaged over the windows
    that tested the month. (None, [warning]) when the table doesn't exist yet.
    """

    client = bq.get_bigquery_client()
    table = f"`{_dataset()}.fc_backtest_forecasts`"
    query = f"""
        SELECT
          customer_id,
          sku,
          month_year,
          AVG(SAFE_DIVIDE(actual_quantity_cartons - predicted_quantity_cartons,
                          predicted_quantity_cartons)) * 100 AS error_pct
        FROM {table}
        WHERE model_name = 'tier1_arima'
          AND predicted_quantity_cartons > 0
          AND actual_quantity_cartons IS NOT NULL
          AND evaluated_at = (SELECT MAX(evaluated_at) FROM {table} WHERE model_name = 'tier1_arima')
        GROUP BY customer_id, sku, month_year
    """
    try:
        rows = list(client.query(query).result())
    except NotFound:
        return None, ["fc_backtest_forecasts does not exist yet: no backtest check this run."]

    errors = {
        (int(row["customer_id"]), str(row["sku"]), row["month_year"]): float(row["error_pct"])
        for row in rows
        if row["error_pct"] is not None
    }
    if not errors:
        return None, ["fc_backtest_forecasts has no rows yet: no backtest check this run."]
    return errors, []


# ============================================================
# READS: CLOUD SQL
# ============================================================


def _read_config(conn: Connection) -> dict:
    row = conn.execute(
        text(
            """
            SELECT
                starting_weight,
                min_exposure,
                reask_points,
                stale_days,
                trend_min_months,
                backtest_tolerance_points

            FROM promo_measurement_config

            WHERE
                superseded_at IS NULL
            """
        )
    ).mappings().first()

    if row is None:
        return dict(DEFAULT_CONFIG)
    return {
        "starting_weight": float(row["starting_weight"]),
        "min_exposure": float(row["min_exposure"]),
        "reask_points": float(row["reask_points"]),
        "stale_days": int(row["stale_days"]),
        "trend_min_months": int(row["trend_min_months"]),
        "backtest_tolerance_points": float(row["backtest_tolerance_points"]),
    }


def _read_promotions(conn: Connection, start: date, end: date) -> dict[int, list[dict]]:
    """Each customer's promotions overlapping the window, with their stores and SKUs."""

    rows = conn.execute(
        text(
            """
            SELECT
                cr.customer_id,
                p.promotion_id,
                p.promo_type,
                p.promotion_mechanic,
                p.voucher,
                p.period_start,
                p.period_end,
                s.retailer_id,
                s.store_code,
                psk.sku

            FROM promotions p
            JOIN promotion_stores ps
                ON ps.promotion_id = p.promotion_id
            JOIN stores s
                ON s.store_id = ps.store_id
            JOIN customer_retailers cr
                ON cr.retailer_id = s.retailer_id
            JOIN promotion_skus psk
                ON psk.promotion_id = p.promotion_id

            WHERE
                p.period_end >= :window_start
                AND p.period_start <= :window_end
                AND p.period_end >= p.period_start
            """
        ),
        {"window_start": start, "window_end": end},
    ).mappings().all()

    promotions: dict[tuple, dict] = {}
    for row in rows:
        promotion = promotions.setdefault(
            (row["customer_id"], row["promotion_id"]),
            {
                "promotion_id": row["promotion_id"],
                "promo_type": row["promo_type"],
                "promotion_mechanic": row["promotion_mechanic"],
                "mechanic_key": rules.mechanic_key(row["promotion_mechanic"]),
                "voucher": rules.voucher_flag(row["voucher"], row["promotion_mechanic"]),
                "period_start": row["period_start"],
                "period_end": row["period_end"],
                "stores": set(),
                "skus": set(),
            },
        )
        promotion["stores"].add(uplifts.store_key(row["retailer_id"], row["store_code"]))
        promotion["skus"].add(row["sku"])

    by_customer: dict[int, list[dict]] = {}
    for (customer_id, _promotion_id), promotion in sorted(promotions.items()):
        by_customer.setdefault(customer_id, []).append(promotion)
    return by_customer


def _read_store_units(conn: Connection, start: date, end: date) -> dict[tuple, dict]:
    """{(customer_id, sku): {store: units}} over the window (monthly rows preferred, as on the dashboard)."""

    rows = conn.execute(
        text(
            EFFECTIVE_SELLOUT_CTE
            + """
            SELECT
                cr.customer_id,
                es.retailer_id,
                es.store_code,
                es.sku,
                SUM(es.quantity_units) AS units

            FROM effective_sellout es
            JOIN customer_retailers cr
                ON cr.retailer_id = es.retailer_id

            WHERE
                es.period_start >= :window_start
                AND es.period_start <= :window_end

            GROUP BY
                cr.customer_id,
                es.retailer_id,
                es.store_code,
                es.sku
            """
        ),
        {"window_start": start, "window_end": end},
    ).mappings().all()

    units: dict[tuple, dict] = {}
    for row in rows:
        store = uplifts.store_key(row["retailer_id"], row["store_code"])
        units.setdefault((row["customer_id"], row["sku"]), {})[store] = float(row["units"] or 0)
    return units


def _read_customer_stores(conn: Connection) -> dict[int, set]:
    rows = conn.execute(
        text(
            """
            SELECT
                cr.customer_id,
                s.retailer_id,
                s.store_code

            FROM stores s
            JOIN customer_retailers cr
                ON cr.retailer_id = s.retailer_id
            """
        )
    ).mappings().all()

    stores: dict[int, set] = {}
    for row in rows:
        stores.setdefault(row["customer_id"], set()).add(uplifts.store_key(row["retailer_id"], row["store_code"]))
    return stores


def _read_sku_ranges(conn: Connection) -> dict[str, str | None]:
    rows = conn.execute(text("SELECT sku, sku_range FROM skus")).mappings().all()
    return {row["sku"]: row["sku_range"] for row in rows}


def _read_mechanic_labels(conn: Connection) -> list[str]:
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                promotion_mechanic

            FROM promotions

            WHERE
                promotion_mechanic IS NOT NULL
            """
        )
    ).all()
    return sorted(row[0] for row in rows)


def _read_current_notes(conn: Connection) -> dict[tuple, dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                id,
                note_type,
                customer_id,
                mechanic_key,
                sku,
                setting_id,
                anchor_id,
                user_value,
                measured_value,
                evidence_months,
                status,
                declined_value

            FROM promo_uplift_pending_notes

            WHERE
                superseded_at IS NULL
            """
        )
    ).mappings().all()
    return {_note_target(row): dict(row) for row in rows}


def _last_success_fingerprint(conn: Connection) -> str | None:
    row = conn.execute(
        text(
            """
            SELECT
                input_fingerprint

            FROM promo_measurement_runs

            WHERE
                status IN ('succeeded', 'succeeded_with_warnings')

            ORDER BY
                finished_at DESC,
                run_id DESC

            LIMIT 1
            """
        )
    ).first()
    return row[0] if row is not None else None


# ============================================================
# MEASURING (no database: everything comes in `inputs`)
# ============================================================


def _rule_based_start(row: dict | None, key: str, anchor_pct: Decimal, rate: Decimal) -> float:
    """
    The rule-based uplift a customer's own uplift is blended with: what the
    mechanic gets without measurement (an all-customers estimate is used as
    typed; the voucher stays at its fixed +3).
    """

    if row is None:
        discount = rules.effective_discount(key)
        return float(rules.rule_based_uplift(discount, anchor_pct, rate)) if discount is not None else 0.0
    if row["source"] == "rule_based" and row["effective_discount_pct"] is not None:
        return float(rules.rule_based_uplift(row["effective_discount_pct"], anchor_pct, rate))
    return float(row["uplift_pct"])


def _measure(inputs: dict, config: dict) -> dict:
    """
    Every customer and SKU value, as targets for _apply, plus the mechanics
    to create and any warnings.
    """

    all_scope = {row["mechanic_key"]: row for row in inputs["settings"] if row["scope"] == "all"}
    discount_by_key = {
        key: Decimal(row["effective_discount_pct"])
        for key, row in all_scope.items()
        if row["effective_discount_pct"] is not None
    }

    warnings: list[str] = []
    to_create: dict[str, dict] = {}
    for label in inputs["labels"]:
        key = rules.mechanic_key(label)
        if key is None:
            warnings.append(f'Promotion mechanic "{label}" cannot be read; its promotions are not measured.')
        elif key not in all_scope and key not in to_create:
            discount = rules.effective_discount(key)
            to_create[key] = {"label": rules.label_for_key(key), "discount": discount}
            if discount is not None:
                discount_by_key[key] = discount

    k = config["starting_weight"]
    rate = inputs["rule_rate"]
    min_exposure = config["min_exposure"]
    tolerance = config["backtest_tolerance_points"]
    backtest = inputs["backtest"] or {}
    targets: list[dict] = []
    reach_by_customer: dict[int, float] = {}

    for customer_id, by_sku in sorted(inputs["training"].items()):
        promotions = inputs["promotions"].get(customer_id, [])
        anchor_pct = inputs["anchors"].get(customer_id, rules.FALLBACK_ANCHOR_PCT)

        raw: dict[str, dict] = {}
        for sku, units_by_month in by_sku.items():
            weights = mrules.store_weights(
                inputs["store_units"].get((customer_id, sku), {}),
                inputs["customer_stores"].get(customer_id, set()),
            )
            sku_promotions = [p for p in promotions if sku in p["skus"]]
            raw[sku] = mrules.exposures(sku_promotions, discount_by_key, weights, units_by_month.keys())

        reach = mrules.usual_reach([row for months in raw.values() for row in months.values()])
        reach_by_customer[customer_id] = reach

        fits: dict[str, dict] = {}
        rel: dict[str, dict] = {}
        method: dict[str, str] = {}
        volume: dict[str, float] = {}
        for sku, units_by_month in by_sku.items():
            rel[sku] = {month: mrules.relative(row, reach) for month, row in raw[sku].items()}
            ratios, method[sku] = mrules.trend_ratios(units_by_month, config["trend_min_months"])
            fits[sku] = mrules.fit_uplifts(ratios, rel[sku], min_exposure)
            volume[sku] = sum(units_by_month.values()) / len(units_by_month) if units_by_month else 0.0

        keys = {key for fit in fits.values() for key in fit}
        keys |= {p["mechanic_key"] for p in promotions if p["mechanic_key"] in discount_by_key}
        if any(p["voucher"] for p in promotions):
            keys.add(rules.VOUCHER_KEY)

        for key in sorted(keys):
            rule_based = _rule_based_start(all_scope.get(key), key, anchor_pct, rate)
            sku_results = []
            for sku in sorted(by_sku):
                fit = fits[sku].get(key)
                if fit is None:
                    continue
                errors = {m: e for (c, s, m), e in backtest.items() if c == customer_id and s == sku}
                counted = {m: rel[sku][m][key] for m in fit["months"]}
                check, check_months = mrules.backtest_check(errors, counted)
                sku_results.append({**fit, "sku": sku, "volume": volume[sku], "check": check, "check_months": check_months})

            big_n = float(len({m for r in sku_results for m in r["months"]}))
            customer_own, blended_customer = mrules.blended_customer_uplift(sku_results, big_n, rule_based, k)

            check_weight = sum(r["check_months"] for r in sku_results if r["check"] is not None)
            customer_check = (
                sum(r["check"] * r["check_months"] for r in sku_results if r["check"] is not None) / check_weight
                if check_weight > 0
                else None
            )

            targets.append({
                "customer_id": customer_id,
                "sku": None,
                "mechanic_key": key,
                "method": None,
                "n": None,
                "big_n": big_n,
                "sku_own_pct": None,
                "customer_own_pct": customer_own,
                "rule_based_pct": rule_based,
                "blended_customer_pct": blended_customer if customer_own is not None else None,
                "starting_weight": k,
                "blended_pct": blended_customer if customer_own is not None else None,
                "backtest_pct": customer_check,
                "backtest_months": check_weight,
                "hold": customer_own is not None and mrules.disagrees(blended_customer, customer_check, tolerance),
                "evidence_months": big_n,
            })

            for result in sku_results:
                blended = mrules.blended_sku_uplift(result["uplift_pct"], result["n"], blended_customer, k)
                targets.append({
                    "customer_id": customer_id,
                    "sku": result["sku"],
                    "mechanic_key": key,
                    "method": method[result["sku"]],
                    "n": result["n"],
                    "big_n": big_n,
                    "sku_own_pct": result["uplift_pct"],
                    "customer_own_pct": customer_own,
                    "rule_based_pct": rule_based,
                    "blended_customer_pct": blended_customer,
                    "starting_weight": k,
                    "blended_pct": blended,
                    "backtest_pct": result["check"],
                    "backtest_months": result["check_months"],
                    "hold": mrules.disagrees(blended, result["check"], tolerance),
                    "evidence_months": result["n"],
                })

    for target in targets:
        value = target["blended_pct"]
        if value is not None and not _MIN_UPLIFT <= value <= _MAX_UPLIFT:
            warnings.append(
                f"{target['mechanic_key']} for customer {target['customer_id']}"
                f"{' SKU ' + target['sku'] if target['sku'] else ''} measured {value:.1f}%, "
                f"kept within {_MIN_UPLIFT:.0f}..{_MAX_UPLIFT:.0f}."
            )
            target["blended_pct"] = min(max(value, _MIN_UPLIFT), _MAX_UPLIFT)

    return {"targets": targets, "to_create": to_create, "warnings": warnings, "reach": reach_by_customer}


# ============================================================
# WRITES
# ============================================================


def _insert_run(conn: Connection, values: dict) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO promo_measurement_runs (
                triggered_by,
                started_at,
                status,
                window_start,
                window_end,
                input_fingerprint,
                config_snapshot,
                counts,
                warnings,
                error
            )
            VALUES (
                :triggered_by,
                :started_at,
                :status,
                :window_start,
                :window_end,
                :input_fingerprint,
                CAST(:config_snapshot AS jsonb),
                CAST(:counts AS jsonb),
                CAST(:warnings AS jsonb),
                :error
            )
            RETURNING run_id
            """
        ),
        {
            "window_start": None,
            "window_end": None,
            "input_fingerprint": None,
            "config_snapshot": None,
            "counts": None,
            "warnings": None,
            "error": None,
            **values,
        },
    ).first()
    return row[0]


def _insert_result(conn: Connection, run_id: int, target: dict, outcome: str, reason: str | None,
                   setting_id: int | None, window: tuple) -> int:
    def dec(value):
        return Decimal(str(round(value, 2))) if value is not None else None

    row = conn.execute(
        text(
            """
            INSERT INTO promo_measurement_results (
                run_id,
                customer_id,
                sku,
                mechanic_key,
                method,
                n,
                big_n,
                sku_own_pct,
                customer_own_pct,
                rule_based_pct,
                blended_customer_pct,
                starting_weight,
                blended_pct,
                backtest_pct,
                backtest_months,
                outcome,
                reason,
                setting_id,
                window_start,
                window_end
            )
            VALUES (
                :run_id,
                :customer_id,
                :sku,
                :mechanic_key,
                :method,
                :n,
                :big_n,
                :sku_own_pct,
                :customer_own_pct,
                :rule_based_pct,
                :blended_customer_pct,
                :starting_weight,
                :blended_pct,
                :backtest_pct,
                :backtest_months,
                :outcome,
                :reason,
                :setting_id,
                :window_start,
                :window_end
            )
            RETURNING id
            """
        ),
        {
            "run_id": run_id,
            "customer_id": target["customer_id"],
            "sku": target["sku"],
            "mechanic_key": target["mechanic_key"],
            "method": target["method"],
            "n": dec(target["n"]),
            "big_n": dec(target["big_n"]),
            "sku_own_pct": dec(target["sku_own_pct"]),
            "customer_own_pct": dec(target["customer_own_pct"]),
            "rule_based_pct": dec(target["rule_based_pct"]),
            "blended_customer_pct": dec(target["blended_customer_pct"]),
            "starting_weight": dec(target["starting_weight"]),
            "blended_pct": dec(target["blended_pct"]),
            "backtest_pct": dec(target["backtest_pct"]),
            "backtest_months": dec(target["backtest_months"]),
            "outcome": outcome,
            "reason": reason,
            "setting_id": setting_id,
            "window_start": window[0],
            "window_end": window[1],
        },
    ).first()
    return row[0]


def _note_target(row: dict) -> tuple:
    return (row["note_type"], row["customer_id"], row.get("mechanic_key"), row.get("sku"))


def _supersede_note(conn: Connection, note_id: int) -> None:
    conn.execute(
        text(
            """
            UPDATE promo_uplift_pending_notes

            SET
                superseded_at = now()

            WHERE
                id = :note_id
                AND superseded_at IS NULL
            """
        ),
        {"note_id": note_id},
    )


def _insert_note(conn: Connection, values: dict) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO promo_uplift_pending_notes (
                note_type,
                customer_id,
                mechanic_key,
                sku,
                setting_id,
                anchor_id,
                user_value,
                measured_value,
                evidence_months,
                result_id,
                status,
                declined_value,
                decided_by,
                decided_at
            )
            VALUES (
                :note_type,
                :customer_id,
                :mechanic_key,
                :sku,
                :setting_id,
                :anchor_id,
                :user_value,
                :measured_value,
                :evidence_months,
                :result_id,
                :status,
                :declined_value,
                :decided_by,
                :decided_at
            )
            RETURNING id
            """
        ),
        {
            "mechanic_key": None,
            "sku": None,
            "setting_id": None,
            "anchor_id": None,
            "evidence_months": None,
            "result_id": None,
            "declined_value": None,
            "decided_by": None,
            "decided_at": None,
            **values,
        },
    ).first()
    return row[0]


def _sync_note(conn: Connection, notes: dict, values: dict, reask: float) -> str | None:
    """
    Keep the note on a typed value in step with the latest measurement.
    Returns what happened ('opened', 'closed' or None for nothing).
    """

    target = _note_target(values)
    note = notes.get(target)
    user, measured = float(values["user_value"]), float(values["measured_value"])

    if abs(user - measured) < _SAME_VALUE_POINTS:
        if note is not None and note["status"] == "open":
            _supersede_note(conn, note["id"])
            _insert_note(conn, {**values, "status": "closed"})
            return "closed"
        return None

    if note is not None and note["status"] == "open":
        same = (
            abs(float(note["user_value"]) - user) < _SAME_VALUE_POINTS
            and abs(float(note["measured_value"]) - measured) < _SAME_VALUE_POINTS
        )
        if same:
            return None
    if note is not None and note["status"] == "kept_mine":
        user_unchanged = abs(float(note["user_value"]) - user) < _SAME_VALUE_POINTS
        moved = abs(measured - float(note["declined_value"])) >= reask
        if user_unchanged and not moved:
            return None

    if note is not None:
        _supersede_note(conn, note["id"])
    _insert_note(conn, {**values, "status": "open"})
    return "opened"


def _close_untouched_notes(conn: Connection, notes: dict, touched: set) -> int:
    closed = 0
    for target, note in notes.items():
        if target in touched or note["status"] != "open":
            continue
        _supersede_note(conn, note["id"])
        _insert_note(
            conn,
            {
                "note_type": note["note_type"],
                "customer_id": note["customer_id"],
                "mechanic_key": note["mechanic_key"],
                "sku": note["sku"],
                "setting_id": note["setting_id"],
                "anchor_id": note["anchor_id"],
                "user_value": note["user_value"],
                "measured_value": note["measured_value"],
                "evidence_months": note["evidence_months"],
                "status": "closed",
            },
        )
        closed += 1
    return closed


def _create_mechanics(conn: Connection, to_create: dict, all_scope: dict, rate: Decimal) -> None:
    for key, item in sorted(to_create.items()):
        discount = item["discount"]
        new_id = uplifts._insert_uplift(
            conn,
            {
                "mechanic_key": key,
                "mechanic_label": item["label"],
                "effective_discount_pct": discount,
                "scope": "all",
                "customer_id": None,
                "sku_range": None,
                "sku": None,
                "uplift_pct": (
                    rules.rule_based_uplift(discount, rules.FALLBACK_ANCHOR_PCT, rate)
                    if discount is not None
                    else Decimal(0)
                ),
                "source": "rule_based",
                "kind": "promotion",
                "evidence_months": None,
                "note": "Added automatically: this mechanic appeared in the promotions data.",
                "changed_by": CHANGED_BY,
                "archived_at": None,
            },
        )
        all_scope[key] = {
            "id": new_id,
            "mechanic_key": key,
            "mechanic_label": item["label"],
            "effective_discount_pct": discount,
            "scope": "all",
            "source": "rule_based",
            "kind": "promotion",
            "archived_at": None,
        }


def _apply(conn: Connection, measured: dict, inputs: dict, config: dict) -> tuple[dict, list[tuple]]:
    """
    Write every target's settings change (append-only) and keep the notes in
    step. Returns (counts, results); the results are written after the run
    row, which needs the counts first.
    """

    window = (inputs["window_start"], inputs["window_end"])
    current = {
        (row["mechanic_key"], row["scope"], row["customer_id"], row["sku_range"], row["sku"]): row
        for row in inputs["settings"]
        if row["scope"] != "all"
    }
    all_scope = {row["mechanic_key"]: row for row in inputs["settings"] if row["scope"] == "all"}
    _create_mechanics(conn, measured["to_create"], all_scope, inputs["rule_rate"])

    notes = inputs["notes"]
    touched: set = set()
    counts = {
        "applied": 0, "unchanged": 0, "held_backtest": 0, "no_evidence": 0,
        "estimate_pending": 0, "skipped": 0, "notes_opened": 0, "notes_closed": 0,
        "mechanics_created": len(measured["to_create"]),
    }

    results: list[tuple] = []

    def record(target, outcome, reason=None, setting_id=None):
        counts[outcome] += 1
        results.append((target, outcome, reason, setting_id, window))

    for target in measured["targets"]:
        key, customer_id, sku = target["mechanic_key"], target["customer_id"], target["sku"]
        base = all_scope.get(key)
        if base is None or base.get("archived_at") is not None:
            record(target, "skipped", "Mechanic archived or missing from settings.")
            continue

        customer_row = current.get((key, "customer", customer_id, None, None))
        if sku is None:
            row, scope = customer_row, "customer"
        else:
            row, scope = current.get((key, "sku", customer_id, None, sku)), "sku"
            sku_range = inputs["sku_ranges"].get(sku)
            range_row = current.get((key, "range", customer_id, sku_range, None)) if sku_range else None
            blocker = next(
                (r for r in (customer_row, range_row) if r is not None and r["source"] == "estimate"),
                None,
            )
            if blocker is not None and not (row is not None and row["source"] == "estimate"):
                record(target, "estimate_pending",
                       f"An uplift typed for the {blocker['scope']} applies to this SKU; not overwritten.",
                       blocker["id"])
                continue

        value = target["blended_pct"]
        if value is None:
            record(target, "no_evidence", "No months with and without this mechanic yet; stays on its current uplift.",
                   row["id"] if row else None)
            continue

        if row is not None and (row["source"] == "learned" or row.get("archived_at") is not None):
            record(target, "skipped", "Uplift is learned or archived.", row["id"])
            continue

        if row is not None and row["source"] == "estimate":
            record(target, "estimate_pending", "Typed uplift kept; see the note.", row["id"])
            outcome = _sync_note(conn, notes, {
                "note_type": "uplift",
                "customer_id": customer_id,
                "mechanic_key": key,
                "sku": sku,
                "setting_id": row["id"],
                "user_value": Decimal(row["uplift_pct"]),
                "measured_value": _one_decimal(value),
                "evidence_months": _one_decimal(target["evidence_months"] or 0),
            }, config["reask_points"])
            touched.add(("uplift", customer_id, key, sku))
            if outcome:
                counts[f"notes_{outcome}"] += 1
            continue

        if target["hold"]:
            record(target, "held_backtest",
                   f"Backtest {target['backtest_pct']:+.1f}% points the other way; previous uplift kept.",
                   row["id"] if row else None)
            continue

        new_value = _one_decimal(value)
        if row is not None and row["source"] == "measured" and Decimal(row["uplift_pct"]) == new_value:
            record(target, "unchanged", None, row["id"])
            continue

        if row is not None:
            uplifts._supersede_uplift(conn, row["id"])
        new_id = uplifts._insert_uplift(
            conn,
            {
                "mechanic_key": key,
                "mechanic_label": base["mechanic_label"],
                "effective_discount_pct": base["effective_discount_pct"],
                "scope": scope,
                "customer_id": customer_id,
                "sku_range": None,
                "sku": sku,
                "uplift_pct": new_value,
                "source": "measured",
                "kind": base.get("kind") or "promotion",
                "evidence_months": _one_decimal(target["evidence_months"] or 0),
                "note": None,
                "changed_by": CHANGED_BY,
                "archived_at": None,
            },
        )
        record(target, "applied", None, new_id)

    for anchor in inputs["anchor_views"]:
        suggested = anchor.get("suggested")
        row = inputs["anchor_rows"].get(anchor["customer_id"])
        if anchor["source"] != "manual" or suggested is None or row is None:
            continue
        outcome = _sync_note(conn, notes, {
            "note_type": "anchor",
            "customer_id": anchor["customer_id"],
            "anchor_id": row["id"],
            "user_value": Decimal(str(anchor["anchor_pct"])),
            "measured_value": Decimal(str(suggested["anchor_pct"])),
            "evidence_months": Decimal(suggested["months_used"]),
        }, config["reask_points"])
        touched.add(("anchor", anchor["customer_id"], None, None))
        if outcome:
            counts[f"notes_{outcome}"] += 1

    counts["notes_closed"] += _close_untouched_notes(conn, notes, touched)
    return counts, results


# ============================================================
# THE RUN
# ============================================================


def _fingerprint_payload(inputs: dict, config: dict) -> dict:
    # Measured rows and notes are the job's own output, so they are left out:
    # otherwise every run would look new to the next one.
    settings = sorted(
        (
            row["mechanic_key"], row["scope"], row["customer_id"], row["sku_range"], row["sku"],
            str(row["uplift_pct"]), row["source"], str(row["effective_discount_pct"]),
            row.get("archived_at") is not None,
        )
        for row in inputs["settings"]
        if row["source"] != "measured"
    )
    return {
        "code": CODE_VERSION,
        "config": config,
        "training": sorted(
            (c, s, str(m), float(u)) for c, by_sku in inputs["training"].items()
            for s, months in by_sku.items() for m, u in months.items()
        ),
        "backtest": sorted((c, s, str(m), round(e, 6)) for (c, s, m), e in (inputs["backtest"] or {}).items()),
        "promotions": sorted(
            (c, p["promotion_id"], p["promo_type"], p["promotion_mechanic"], p["voucher"],
             str(p["period_start"]), str(p["period_end"]), sorted(p["stores"]), sorted(p["skus"]))
            for c, promos in inputs["promotions"].items() for p in promos
        ),
        "store_units": sorted((c, s, sorted(units.items())) for (c, s), units in inputs["store_units"].items()),
        "settings": settings,
        "anchors": sorted((c, str(a)) for c, a in inputs["anchors"].items()),
        # A change to the rule moves every rule-based starting point, so it
        # must trigger a re-measure.
        "rule_rate": str(inputs["rule_rate"]),
        "labels": inputs["labels"],
    }


def _training_by_customer(rows: list[dict]) -> dict[int, dict[str, dict[date, float]]]:
    training: dict[int, dict[str, dict[date, float]]] = {}
    for row in rows:
        if row["quantity_cartons"] is None:
            continue
        month = row["month_year"]
        if isinstance(month, datetime):
            month = month.date()
        training.setdefault(int(row["customer_id"]), {}).setdefault(str(row["sku"]), {})[month] = float(row["quantity_cartons"])
    return training


def _read_inputs(conn: Connection, training: dict, backtest: dict | None) -> dict:
    months = [m for by_sku in training.values() for units in by_sku.values() for m in units]
    window_start = min(months)
    last_month = max(months)
    window_end = last_month.replace(day=mrules.days_in_month(last_month))

    anchor_views = uplifts._anchors(conn)
    return {
        "window_start": window_start,
        "window_end": window_end,
        "training": training,
        "backtest": backtest,
        "settings": uplifts._current_uplift_rows(conn),
        "anchor_views": anchor_views,
        "anchors": {a["customer_id"]: Decimal(str(a["anchor_pct"])) for a in anchor_views},
        "anchor_rows": uplifts._current_anchor_rows(conn),
        "rule_rate": uplifts._current_rate(conn),
        "promotions": _read_promotions(conn, window_start, window_end),
        "store_units": _read_store_units(conn, window_start, window_end),
        "customer_stores": _read_customer_stores(conn),
        "sku_ranges": _read_sku_ranges(conn),
        "labels": _read_mechanic_labels(conn),
        "notes": _read_current_notes(conn),
    }


def _summary(run_id: int, status: str, inputs: dict | None, counts: dict | None, warnings: list[str]) -> dict:
    return {
        "run_id": run_id,
        "status": status,
        "window_start": inputs["window_start"].isoformat() if inputs else None,
        "window_end": inputs["window_end"].isoformat() if inputs else None,
        "counts": counts or {},
        "warnings": warnings,
    }


def _json(value) -> str:
    return json.dumps(value, default=str)


def _run(triggered_by: str, started_at: datetime) -> dict:
    training = _training_by_customer(_read_training())
    if not training:
        raise ValueError("fc_training_input has no rows: there is nothing to measure.")
    backtest, warnings = _read_backtest_errors()

    with common.get_engine().begin() as conn:
        locked = conn.execute(text("SELECT pg_try_advisory_xact_lock(:lock_key)"), {"lock_key": _LOCK_KEY}).scalar()
        if not locked:
            raise MeasurementRunningError("A measurement run is already in progress; try again in a minute.")

        config = _read_config(conn)
        inputs = _read_inputs(conn, training, backtest)
        fingerprint = mrules.fingerprint(_fingerprint_payload(inputs, config))

        base_run = {
            "triggered_by": triggered_by,
            "started_at": started_at,
            "window_start": inputs["window_start"],
            "window_end": inputs["window_end"],
            "input_fingerprint": fingerprint,
            "config_snapshot": _json(config),
        }

        if fingerprint == _last_success_fingerprint(conn):
            run_id = _insert_run(conn, {**base_run, "status": "skipped_unchanged", "warnings": _json(warnings)})
            return _summary(run_id, "skipped_unchanged", inputs, None, warnings)

        measured = _measure(inputs, config)
        warnings = warnings + measured["warnings"]
        # Missing backtest data alone is expected (early on), not a warning-level run.
        alarming = measured["warnings"]
        status = "succeeded_with_warnings" if alarming else "succeeded"

        counts, results = _apply(conn, measured, inputs, config)
        counts["usual_reach"] = {str(c): round(r, 3) for c, r in measured["reach"].items()}
        run_id = _insert_run(conn, {
            **base_run, "status": status, "counts": _json(counts), "warnings": _json(warnings),
        })
        for target, outcome, reason, setting_id, window in results:
            _insert_result(conn, run_id, target, outcome, reason, setting_id, window)

    for warning in alarming:
        # ERROR level: the Cloud Monitoring log alert picks these up.
        logger.error("Promotion uplift measurement warning: %s", warning)
    return _summary(run_id, status, inputs, counts, warnings)


def _record_failure(triggered_by: str, started_at: datetime, error: Exception) -> None:
    with common.get_engine().begin() as conn:
        _insert_run(conn, {
            "triggered_by": triggered_by,
            "started_at": started_at,
            "status": "failed",
            "error": f"{type(error).__name__}: {error}"[:4000],
        })


def run_measurement(triggered_by: str = "scheduler") -> dict:
    """
    Measure every mechanic's uplift and update Promotion Uplift Settings, in
    one transaction. Skips (and records the skip) when nothing changed since
    the last successful run. A failure changes nothing: it is recorded as a
    'failed' run, logged at ERROR level and raised.
    """

    if triggered_by not in TRIGGERS:
        raise ValueError(f"triggered_by must be one of {', '.join(TRIGGERS)}")

    started_at = _utc_now()
    try:
        return _run(triggered_by, started_at)
    except MeasurementRunningError:
        raise
    except Exception as error:
        logger.exception("Promotion uplift measurement failed")
        try:
            _record_failure(triggered_by, started_at, error)
        except Exception:
            logger.exception("Could not record the failed measurement run")
        raise


# ============================================================
# STATUS, EVIDENCE AND NOTES (for the settings page)
# ============================================================


def _next_due(now: datetime) -> datetime:
    local = now.astimezone(_SINGAPORE)
    due = local.replace(hour=SCHEDULE_HOUR_SGT, minute=0, second=0, microsecond=0)
    if due <= local:
        due += timedelta(days=1)
    return due.astimezone(timezone.utc)


def _run_view(row) -> dict | None:
    if row is None:
        return None
    return {
        "run_id": row["run_id"],
        "triggered_by": row["triggered_by"],
        "status": row["status"],
        "started_at": common.iso(row["started_at"]),
        "finished_at": common.iso(row["finished_at"]),
        "window_start": row["window_start"].isoformat() if row["window_start"] else None,
        "window_end": row["window_end"].isoformat() if row["window_end"] else None,
        "counts": row["counts"],
        "warnings": row["warnings"],
        "error": row["error"],
    }


_RUN_COLUMNS = """
    run_id,
    triggered_by,
    status,
    started_at,
    finished_at,
    window_start,
    window_end,
    counts,
    warnings,
    error
"""


def measurement_status() -> dict:
    """Last run, last successful run, next scheduled run, stale flag and open notes, for the settings page."""

    now = _utc_now()
    with common.read_connection() as conn:
        config = _read_config(conn)
        last = conn.execute(
            text(f"SELECT {_RUN_COLUMNS} FROM promo_measurement_runs ORDER BY finished_at DESC, run_id DESC LIMIT 1")
        ).mappings().first()
        last_success = conn.execute(
            text(
                f"""
                SELECT {_RUN_COLUMNS}
                FROM promo_measurement_runs
                WHERE status IN ('succeeded', 'succeeded_with_warnings', 'skipped_unchanged')
                ORDER BY finished_at DESC, run_id DESC
                LIMIT 1
                """
            )
        ).mappings().first()
        open_notes = conn.execute(
            text("SELECT COUNT(*) FROM promo_uplift_pending_notes WHERE superseded_at IS NULL AND status = 'open'")
        ).scalar()

    stale = last_success is None or now - last_success["finished_at"] > timedelta(days=config["stale_days"])
    return {
        "last_run": _run_view(last),
        "last_success": _run_view(last_success),
        "next_due": common.iso(_next_due(now)),
        "stale": stale,
        "stale_days": config["stale_days"],
        "open_notes": int(open_notes or 0),
    }


def _result_view(row) -> dict | None:
    if row is None:
        return None
    return {
        "run_id": row["run_id"],
        "run_finished_at": common.iso(row["finished_at"]),
        "customer_id": row["customer_id"],
        "sku": row["sku"],
        "mechanic_key": row["mechanic_key"],
        "method": row["method"],
        "n": _num(row["n"]),
        "big_n": _num(row["big_n"]),
        "sku_own_pct": _num(row["sku_own_pct"]),
        "customer_own_pct": _num(row["customer_own_pct"]),
        "rule_based_pct": _num(row["rule_based_pct"]),
        "blended_customer_pct": _num(row["blended_customer_pct"]),
        "starting_weight": _num(row["starting_weight"]),
        "blended_pct": _num(row["blended_pct"]),
        "backtest_pct": _num(row["backtest_pct"]),
        "backtest_months": _num(row["backtest_months"]),
        "outcome": row["outcome"],
        "reason": row["reason"],
        "window_start": row["window_start"].isoformat() if row["window_start"] else None,
        "window_end": row["window_end"].isoformat() if row["window_end"] else None,
    }


def evidence(setting_id: int) -> dict:
    """The latest measurement behind an uplift (customer or SKU level); None for all-customers uplifts."""

    with common.read_connection() as conn:
        setting = conn.execute(
            text(
                """
                SELECT
                    id,
                    mechanic_key,
                    scope,
                    customer_id,
                    sku

                FROM promo_uplift_settings

                WHERE
                    id = :setting_id
                """
            ),
            {"setting_id": setting_id},
        ).mappings().first()
        if setting is None:
            raise uplifts.UpliftSettingNotFoundError(f"Uplift setting {setting_id} does not exist.")
        if setting["scope"] not in ("customer", "sku"):
            return {"setting_id": setting_id, "result": None}

        row = conn.execute(
            text(
                """
                SELECT
                    r.*,
                    run.finished_at

                FROM promo_measurement_results r
                JOIN promo_measurement_runs run
                    ON run.run_id = r.run_id

                WHERE
                    r.customer_id = :customer_id
                    AND r.mechanic_key = :mechanic_key
                    AND r.sku IS NOT DISTINCT FROM CAST(:sku AS varchar)

                ORDER BY
                    r.run_id DESC,
                    r.id DESC

                LIMIT 1
                """
            ),
            {"customer_id": setting["customer_id"], "mechanic_key": setting["mechanic_key"], "sku": setting["sku"]},
        ).mappings().first()

    return {"setting_id": setting_id, "result": _result_view(row)}


def list_notes() -> list[dict]:
    """Open notes: where a measured value (or suggested anchor) differs from one a person typed."""

    with common.read_connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    n.id,
                    n.note_type,
                    n.customer_id,
                    c.customer_name,
                    n.mechanic_key,
                    n.sku,
                    k.product_name,
                    n.setting_id,
                    n.anchor_id,
                    n.user_value,
                    n.measured_value,
                    n.evidence_months,
                    n.created_at

                FROM promo_uplift_pending_notes n
                JOIN customers c
                    ON c.customer_id = n.customer_id
                LEFT JOIN skus k
                    ON k.sku = n.sku

                WHERE
                    n.superseded_at IS NULL
                    AND n.status = 'open'

                ORDER BY
                    c.customer_name ASC,
                    n.mechanic_key ASC NULLS FIRST,
                    n.sku ASC NULLS FIRST
                """
            )
        ).mappings().all()

    return [
        {
            "id": row["id"],
            "note_type": row["note_type"],
            "customer_id": row["customer_id"],
            "customer_name": row["customer_name"],
            "mechanic_key": row["mechanic_key"],
            "sku": row["sku"],
            "product_name": row["product_name"],
            "setting_id": row["setting_id"],
            "anchor_id": row["anchor_id"],
            "user_value": _num(row["user_value"]),
            "measured_value": _num(row["measured_value"]),
            "evidence_months": _num(row["evidence_months"]),
            "created_at": common.iso(row["created_at"]),
        }
        for row in rows
    ]


def _lock_open_note(conn: Connection, note_id: int) -> dict:
    row = conn.execute(
        text(
            """
            SELECT
                *

            FROM promo_uplift_pending_notes

            WHERE
                id = :note_id

            FOR UPDATE
            """
        ),
        {"note_id": note_id},
    ).mappings().first()

    if row is None:
        raise NoteNotFoundError(f"Note {note_id} does not exist.")
    if row["superseded_at"] is not None or row["status"] != "open":
        raise NoteConflictError("This note has already been dealt with; reload the page.")
    return dict(row)


def _decide(conn: Connection, note: dict, status: str, updated_by: str | None, declined: Decimal | None = None) -> None:
    _supersede_note(conn, note["id"])
    _insert_note(conn, {
        "note_type": note["note_type"],
        "customer_id": note["customer_id"],
        "mechanic_key": note["mechanic_key"],
        "sku": note["sku"],
        "setting_id": note["setting_id"],
        "anchor_id": note["anchor_id"],
        "user_value": note["user_value"],
        "measured_value": note["measured_value"],
        "evidence_months": note["evidence_months"],
        "result_id": note["result_id"],
        "status": status,
        "declined_value": declined,
        "decided_by": updated_by or uplifts.DEFAULT_CHANGED_BY,
        "decided_at": _utc_now(),
    })


def use_measured(note_id: int, updated_by: str | None = None) -> dict:
    """[Use measured]: the typed value (or anchor) is replaced by the measured one, as a new version."""

    with common.get_engine().begin() as conn:
        note = _lock_open_note(conn, note_id)

        if note["note_type"] == "uplift":
            row = uplifts._lock_current_row(conn, note["setting_id"])
            if row["source"] != "estimate":
                raise NoteConflictError("The value has changed since this note was written; reload the page.")
            uplifts._supersede_uplift(conn, row["id"])
            uplifts._insert_uplift(conn, uplifts._copy(
                row,
                uplift_pct=note["measured_value"],
                source="measured",
                evidence_months=note["evidence_months"],
                changed_by=updated_by or uplifts.DEFAULT_CHANGED_BY,
            ))
        else:
            current = uplifts._current_anchor_rows(conn).get(note["customer_id"])
            if current is None or current["id"] != note["anchor_id"]:
                raise NoteConflictError("The ordinary-month discount has changed since this note was written; reload.")
            uplifts._supersede_anchor(conn, note["customer_id"])
            uplifts._insert_anchor(conn, note["customer_id"], None, "suggested",
                                   updated_by or uplifts.DEFAULT_CHANGED_BY)

        _decide(conn, note, "used_measured", updated_by)

    return {"changed": True}


def keep_mine(note_id: int, updated_by: str | None = None) -> dict:
    """[Keep mine]: the typed value stays; asked again only if the measured value moves by reask_points."""

    with common.get_engine().begin() as conn:
        note = _lock_open_note(conn, note_id)
        _decide(conn, note, "kept_mine", updated_by, declined=note["measured_value"])

    return {"changed": True}
