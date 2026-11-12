import json
import logging
from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.settings import common
from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_moment_rules as moment_rules
from app.services.settings import promo_moments
from app.services.settings import promo_recalc_events as events
from app.services.settings import promo_uplifts


# Works out one customer's promotion moments, uplifts and projected anchors
# and saves them (promo_moment_calc, promo_uplift_calc, projected rows in
# promo_anchor_settings; migration 020), so pages only read the results.
# Run by the queue (process_pending: the Cloud Task, Recalculate on
# Promotion Uplift Settings, scripts/rebuild_promo_calc.py), never by a page
# load. Each customer is one transaction; the rules are pure and live in
# promo_anchor_versions.py.

logger = logging.getLogger("uvicorn.error")

# Who a projected anchor is recorded as having been saved by.
PROJECTION_USER = "aireos (projected from official promotions)"


# ============================================================
# SMALL HELPERS
# ============================================================


def _jsonable(value):
    # choose_uplift's explanation holds dates and Decimals.
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _discounts(conn: Connection) -> dict[str, dict]:
    """Each mechanic's standard label and effective discount, from its all-customers uplift row."""

    return promo_uplifts.mechanic_discounts(conn)


def _version_months(anchor_rows: list[dict], this_month: date) -> list[date]:
    later = {row["effective_from"] for row in anchor_rows if row["effective_from"] and row["effective_from"] > this_month}
    return [this_month, *sorted(later)]


# ============================================================
# ONE CUSTOMER
# ============================================================


def _save_moments(conn: Connection, customer_id: int, measured: list[dict], planned: list[dict]) -> None:
    conn.execute(text("DELETE FROM promo_moment_calc WHERE customer_id = :customer_id"), {"customer_id": customer_id})

    real = {(m["sku"], m["month"]) for m in measured}
    rows = [
        {
            "customer_id": customer_id,
            "sku": m["sku"],
            "month": m["month"],
            "promotion_id": m["promotion_id"],
            "mechanic_key": m["mechanic_key"],
            "mechanic_label": m["mechanic_label"],
            "planned": False,
            "units": m["units"],
            "anchor_id": m["version_id"],
            "version_from": m["version_from"],
            "baseline_mechanic_key": m["baseline_mechanic_key"],
            "baseline_units": m["baseline_units"],
            "baseline_source": m["baseline_source"],
            "baseline_months": m["baseline_months"],
            "is_baseline": m["is_baseline"],
            "uplift_pct": m["uplift_pct"],
        }
        for m in measured
    ] + [
        {
            "customer_id": customer_id,
            "sku": m["sku"],
            "month": m["month"],
            "promotion_id": m["promotion_id"],
            "mechanic_key": m["mechanic_key"],
            "mechanic_label": m["mechanic_label"],
            "planned": True,
            "units": None,
            "anchor_id": None,
            "version_from": None,
            "baseline_mechanic_key": None,
            "baseline_units": None,
            "baseline_source": None,
            "baseline_months": [],
            "is_baseline": None,
            "uplift_pct": None,
        }
        for m in planned
        if (m["sku"], m["month"]) not in real
    ]
    if not rows:
        return

    conn.execute(
        text(
            """
            INSERT INTO promo_moment_calc (
                customer_id, sku, month, promotion_id, mechanic_key, mechanic_label, planned, units,
                anchor_id, version_from, baseline_mechanic_key, baseline_units, baseline_source,
                baseline_months, is_baseline, uplift_pct
            )
            VALUES (
                :customer_id, :sku, :month, :promotion_id, :mechanic_key, :mechanic_label, :planned, :units,
                :anchor_id, :version_from, :baseline_mechanic_key, :baseline_units, :baseline_source,
                CAST(:baseline_months AS date[]), :is_baseline, :uplift_pct
            )
            """
        ),
        rows,
    )


def _save_uplifts(conn: Connection, customer_id: int, uplifts: list[dict]) -> None:
    conn.execute(text("DELETE FROM promo_uplift_calc WHERE customer_id = :customer_id"), {"customer_id": customer_id})
    if not uplifts:
        return

    conn.execute(
        text(
            """
            INSERT INTO promo_uplift_calc (
                customer_id, sku, mechanic_key, anchor_id, version_from, level, uplift_pct, explanation
            )
            VALUES (
                :customer_id, :sku, :mechanic_key, :anchor_id, :version_from, :level, :uplift_pct,
                CAST(:explanation AS JSONB)
            )
            """
        ),
        [
            {
                "customer_id": customer_id,
                "sku": row["sku"],
                "mechanic_key": row["mechanic_key"],
                "anchor_id": row["anchor"]["version_id"],
                "version_from": row["anchor"]["effective_from"],
                "level": row["level"],
                "uplift_pct": row["uplift_pct"],
                "explanation": json.dumps(_jsonable({
                    key: row[key] for key in ("anchor", "moments", "placeholder")
                })),
            }
            for row in uplifts
        ],
    )


def _save_status(conn: Connection, customer_id: int, warnings: list[str]) -> None:
    conn.execute(
        text(
            """
            INSERT INTO promo_calc_status (customer_id, calculated_at, warnings, last_error, last_error_at)
            VALUES (:customer_id, CURRENT_TIMESTAMP, CAST(:warnings AS JSONB), NULL, NULL)
            ON CONFLICT (customer_id) DO UPDATE
            SET
                calculated_at = EXCLUDED.calculated_at,
                warnings = EXCLUDED.warnings,
                last_error = NULL,
                last_error_at = NULL
            """
        ),
        {"customer_id": customer_id, "warnings": json.dumps(warnings)},
    )


def recalculate_customer(customer_id: int) -> dict:
    """
    One customer, in one transaction: its moments (real and planned), the
    anchor changes its official future promotions bring (saved as projected
    rows), each moment measured against its month's anchor version, and the
    uplift per SKU x mechanic x version. Replaces its worked-out rows.
    """

    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)
        inputs = promo_moments.customer_inputs(conn, customer_id)
        sku_ranges = promo_moments.sku_ranges(conn)
        discounts = _discounts(conn)
        this_month = common.this_month()

        moments = moment_rules.find_moments(inputs["promotions"], inputs["units"])
        planned = versions.find_planned_moments(inputs["promotions"], inputs["sales_through"])

        # Anchors: the customer's saves are locked out while its projection is written.
        promo_uplifts._lock(conn, "promo_anchor_settings")
        anchor_rows = promo_uplifts._anchor_rows(conn)
        anchor_for = versions.version_lookup(anchor_rows)

        # Only targets with an anchor saved are projected: one with none is
        # still measured against its most common mechanic (seed_anchors first).
        targets = {(customer_id, None)} | {
            (customer_id, sku_ranges[m["sku"]]) for m in moments + planned if sku_ranges.get(m["sku"])
        }
        saved = {target for target in targets if anchor_for(customer_id, target[1], this_month)["version_id"] is not None}
        changes = versions.project_anchors(moments, planned, sku_ranges, this_month, targets=saved)

        inserts, warnings = versions.projected_to_save(anchor_rows, changes, customer_id, this_month, discounts)
        for values in inserts:
            promo_uplifts._insert_anchor(conn, {**values, "updated_by": PROJECTION_USER})
        if inserts:
            anchor_rows = promo_uplifts._anchor_rows(conn)
            anchor_for = versions.version_lookup(anchor_rows)

        measured = versions.measure_by_version(moments, sku_ranges, anchor_for)
        uplifts = versions.uplifts_to_save(
            measured,
            customer_id,
            sku_ranges,
            anchor_for,
            _version_months(anchor_rows, this_month),
            lambda key: discounts.get(key, {}).get("discount_pct"),
        )

        _save_moments(conn, customer_id, measured, planned)
        _save_uplifts(conn, customer_id, uplifts)
        _save_status(conn, customer_id, warnings)

    return {
        "customer_id": customer_id,
        "moments": len(measured),
        "planned_moments": len(planned),
        "uplifts": len(uplifts),
        "projected_anchors": len(inserts),
        "warnings": warnings,
    }


# ============================================================
# THE QUEUE
# ============================================================


def _claim(conn: Connection) -> list[int]:
    """Every pending request, marked processed in one statement, as the customers to work out."""

    claimed = conn.execute(
        text(
            """
            UPDATE promo_recalc_requests

            SET
                processed_at = CURRENT_TIMESTAMP

            WHERE
                processed_at IS NULL

            RETURNING customer_id
            """
        )
    ).all()

    customer_ids = {row[0] for row in claimed}
    if None in customer_ids:
        return [row[0] for row in conn.execute(text("SELECT customer_id FROM customers ORDER BY customer_id")).all()]
    return sorted(customer_ids)


def _record_failure(customer_id: int, error: Exception) -> None:
    # Its own transaction: the failed one rolled back. The customer goes back
    # in the queue so the next run tries again.
    with common.get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO promo_calc_status (customer_id, last_error, last_error_at)
                VALUES (:customer_id, :last_error, CURRENT_TIMESTAMP)
                ON CONFLICT (customer_id) DO UPDATE
                SET
                    last_error = EXCLUDED.last_error,
                    last_error_at = EXCLUDED.last_error_at
                """
            ),
            {"customer_id": customer_id, "last_error": f"{type(error).__name__}: {error}"},
        )
        events.record_customers(conn, "retry", [customer_id], force=True)


def process_pending() -> dict:
    """
    Work out every customer with a pending request, each once however many
    saves asked for it. A customer that fails keeps its error and is queued
    again; the others are unaffected.
    """

    with common.get_engine().begin() as conn:
        customer_ids = _claim(conn)

    done, failed = [], []
    for customer_id in customer_ids:
        try:
            done.append(recalculate_customer(customer_id))
        except common.CustomerNotFoundError:
            # Deleted since the request was saved; its rows went with it.
            continue
        except Exception as exc:
            logger.exception("Promo recalculation failed for customer %s", customer_id)
            _record_failure(customer_id, exc)
            failed.append({"customer_id": customer_id, "error": f"{type(exc).__name__}: {exc}"})

    events.enqueue_best_effort(bool(failed))
    return {"customers": done, "failed": failed}


def recalculate(customer_id: int | None = None) -> dict:
    """Recalculate now (Recalculate, the rebuild script): queue the customer (None = every customer) and run the queue."""

    with common.get_engine().begin() as conn:
        if customer_id is not None:
            common.lock_customer(conn, customer_id)
        events.record_customers(conn, "manual", [customer_id] if customer_id is not None else None, force=True)
    return process_pending()
