import json
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.scenario import building_blocks, common


# Scenario builder promotions (scenario_promotions, migration 018): planned
# by SKU range (sku_ranges; sku only on ones saved before ranges),
# promotions that only move the Scenario builder's Simulated line, saved
# and switched on/off exactly like building blocks (building_blocks.py).
# Nothing here reads or writes the forecast, the real `promotions` table,
# the promo anchors (an anchor moves only once real sales show the new
# discount), Inventory or Dashboard; the frontend applies a promotion to the Current
# forecast itself (app/utils/scenarioPromotions.js).
#
# Uplift values arrive in the body as the page copied them from Promotion
# Uplift Settings and are stored as sent: a later settings change (an
# edit, a moved anchor, measured values) never moves a saved promotion.
#
# Like building blocks, a promotion covers several customers (customer_ids,
# migration 022; NULL = every customer) and each customer x SKU range can be
# switched off (excluded_pairs, 023). Each customer's copied values are kept
# in references_by_customer (025), keyed by customer id; the single
# reference_* / voucher_* columns carry the first customer's.


# ============================================================
# READ
# ============================================================

_PROMOTION_SELECT = f"""
    SELECT
        promotion.promotion_id,
        promotion.plan,
        {common.customer_names_select("promotion")},
        promotion.sku_ranges,
        {common.excluded_pairs_select("promotion")},
        -- Each customer's values, named back; a deleted customer's are gone.
        COALESCE(
            (
                SELECT jsonb_object_agg(customer.customer_name, refs.value)
                FROM jsonb_each(promotion.references_by_customer) AS refs
                JOIN customers AS customer
                    ON customer.customer_id = refs.key::INTEGER
            ),
            '{{}}'::jsonb
        ) AS references_by_customer,
        promotion.sku,
        product.product_name,
        promotion.promo_type,
        promotion.mechanic_key,
        promotion.mechanic_label,
        promotion.reference_uplift_pct,
        promotion.reference_source,
        promotion.reference_by_sku,
        promotion.override_uplift_pct,
        promotion.voucher,
        promotion.voucher_uplift_pct,
        promotion.voucher_by_sku,
        promotion.explanation,
        promotion.start_month,
        promotion.end_month,
        promotion.start_date,
        promotion.end_date,
        promotion.is_active,
        promotion.created_at,
        promotion.updated_at

    FROM scenario_promotions AS promotion

    LEFT JOIN skus AS product
        ON product.sku = promotion.sku
"""


def _number(value) -> float | None:
    return float(value) if value is not None else None


def _by_sku_view(values: dict | None) -> dict[str, float]:
    return {product: float(value) for product, value in (values or {}).items()}


def _references_view(values: dict) -> dict:
    return {
        "reference_uplift_pct": float(values["reference_uplift_pct"]),
        "reference_source": values["reference_source"],
        "reference_by_sku": _by_sku_view(values.get("reference_by_sku")),
        "voucher_uplift_pct": float(values.get("voucher_uplift_pct") or 0),
        "voucher_by_sku": _by_sku_view(values.get("voucher_by_sku")),
        "reference_details": values.get("reference_details") or [],
    }


def _promotion_view(row: dict) -> dict:
    return {
        "promotion_id": row["promotion_id"],
        "plan": row.get("plan", "scenario"),
        # None = every customer, as sku_ranges.
        "customer_names": list(row["customer_names"]) or None,
        "sku_ranges": list(row["sku_ranges"]) if row["sku_ranges"] else None,
        "excluded_pairs": list(row["excluded_pairs"] or []),
        "references_by_customer": {
            name: _references_view(values) for name, values in (row["references_by_customer"] or {}).items()
        },
        "sku": row["sku"],
        "product_name": row["product_name"],
        "promo_type": row["promo_type"],
        "mechanic_key": row["mechanic_key"],
        "mechanic_label": row["mechanic_label"],
        "reference_uplift_pct": float(row["reference_uplift_pct"]),
        "reference_source": row["reference_source"],
        "reference_by_sku": _by_sku_view(row["reference_by_sku"]),
        "override_uplift_pct": _number(row["override_uplift_pct"]),
        "voucher": row["voucher"],
        "voucher_uplift_pct": float(row["voucher_uplift_pct"]),
        "voucher_by_sku": _by_sku_view(row["voucher_by_sku"]),
        "explanation": row["explanation"],
        "start_month": row["start_month"].isoformat(),
        "end_month": row["end_month"].isoformat(),
        "start_date": row["start_date"].isoformat() if row["start_date"] else None,
        "end_date": row["end_date"].isoformat() if row["end_date"] else None,
        "is_active": row["is_active"],
        "created_at": common.iso(row["created_at"]),
        "updated_at": common.iso(row["updated_at"]),
    }


def _select_for_schema(has_plan: bool) -> str:
    return _PROMOTION_SELECT if has_plan else _PROMOTION_SELECT.replace("promotion.plan,", "'scenario' AS plan,")


def _fetch_promotion(conn: Connection, promotion_id: int, has_plan: bool = True) -> dict | None:
    row = conn.execute(
        text(
            f"""
            {_select_for_schema(has_plan)}

            WHERE
                promotion.promotion_id = :promotion_id
            """
        ),
        {"promotion_id": promotion_id},
    ).mappings().first()

    return _promotion_view(dict(row)) if row is not None else None


def list_scenario_promotions(plan: str = "scenario", year: int | None = None) -> list[dict]:
    """Every saved Scenario promotion of a plan (or of one budget year), newest first; the page filters them itself."""
    common.validate_plan(plan)

    with common.read_connection() as conn:
        has_plan = common.require_plan(conn, "scenario_promotions", plan)
        scope = "promotion.plan = :plan" if has_plan else "TRUE"
        # Budget planning reads one year's entries at a time.
        year_condition, year_params = common.year_scope("promotion", year)
        rows = conn.execute(
            text(
                f"""
                {_select_for_schema(has_plan)}

                WHERE {scope} {year_condition}

                ORDER BY
                    promotion.created_at DESC,
                    promotion.promotion_id DESC
                """
            ),
            {"plan": plan, **year_params},
        ).mappings().all()

    return [_promotion_view(dict(row)) for row in rows]


# ============================================================
# WRITE PARAMETERS
# ============================================================


def _by_sku_json(values: dict[str, Decimal]) -> str:
    # JSONB holds plain numbers; the schema allows at most 2 decimals.
    return json.dumps({product: float(value) for product, value in values.items()})


def _references_json(conn: Connection, references: dict[str, dict]) -> str:
    """Each customer's copied values as stored: keyed by customer id (every name must exist)."""

    names = sorted(references)
    ids = dict(zip(names, building_blocks.resolve_customer_ids(conn, names) or []))
    return json.dumps(
        {
            str(ids[name]): {
                "reference_uplift_pct": float(values["reference_uplift_pct"]),
                "reference_source": values["reference_source"],
                "reference_by_sku": {product: float(value) for product, value in values["reference_by_sku"].items()},
                "voucher_uplift_pct": float(values["voucher_uplift_pct"]),
                "voucher_by_sku": {product: float(value) for product, value in values["voucher_by_sku"].items()},
                "reference_details": values.get("reference_details") or [],
            }
            for name, values in references.items()
        }
    )


def _write_params(conn: Connection, promotion: dict) -> dict:
    # Same name lookups as building blocks, so both kinds of item resolve
    # a customer or product the same way.
    customer_ids = building_blocks.resolve_customer_ids(conn, promotion["customer_names"])
    return {
        "plan": promotion.get("plan", "scenario"),
        "customer_ids": customer_ids,
        # The one customer, or None for several or every customer.
        "customer_id": customer_ids[0] if customer_ids and len(customer_ids) == 1 else None,
        "excluded_pairs": building_blocks.excluded_pairs_json(conn, promotion["excluded_pairs"]),
        "references_by_customer": _references_json(conn, promotion["references_by_customer"]),
        "sku_ranges": building_blocks._resolve_sku_ranges(conn, promotion["sku_ranges"]),
        "sku": building_blocks._resolve_sku(conn, promotion["product_name"]),
        "promo_type": promotion["promo_type"],
        "mechanic_key": promotion["mechanic_key"],
        "mechanic_label": promotion["mechanic_label"],
        "reference_uplift_pct": promotion["reference_uplift_pct"],
        "reference_source": promotion["reference_source"],
        "reference_by_sku": _by_sku_json(promotion["reference_by_sku"]),
        "override_uplift_pct": promotion["override_uplift_pct"],
        "voucher": promotion["voucher"],
        "voucher_uplift_pct": promotion["voucher_uplift_pct"],
        "voucher_by_sku": _by_sku_json(promotion["voucher_by_sku"]),
        "explanation": promotion["explanation"],
        "start_month": promotion["start_month"],
        "end_month": promotion["end_month"],
        "start_date": promotion["start_date"],
        "end_date": promotion["end_date"],
        "is_active": promotion["is_active"],
    }


# ============================================================
# WRITES
#
# `promotion` is a ScenarioPromotionCreate/Update dumped to a dict,
# already validated. Each write is one transaction.
# ============================================================


def insert_scenario_promotion(conn: Connection, promotion: dict, has_plan: bool = True) -> int:
    """Insert one Scenario promotion inside the caller's transaction; its new id. Budget versions copy promotions back through it."""
    plan_column = "plan," if has_plan else ""
    plan_value = ":plan," if has_plan else ""
    return conn.execute(
        text(
            f"""
            INSERT INTO scenario_promotions (
                {plan_column}
                customer_id,
                customer_ids,
                excluded_pairs,
                references_by_customer,
                sku_ranges,
                sku,
                promo_type,
                mechanic_key,
                mechanic_label,
                reference_uplift_pct,
                reference_source,
                reference_by_sku,
                override_uplift_pct,
                voucher,
                voucher_uplift_pct,
                voucher_by_sku,
                explanation,
                start_month,
                end_month,
                start_date,
                end_date,
                is_active
            )
            VALUES (
                {plan_value}
                :customer_id,
                CAST(:customer_ids AS INTEGER[]),
                CAST(:excluded_pairs AS JSONB),
                CAST(:references_by_customer AS JSONB),
                CAST(:sku_ranges AS TEXT[]),
                :sku,
                :promo_type,
                :mechanic_key,
                :mechanic_label,
                :reference_uplift_pct,
                :reference_source,
                CAST(:reference_by_sku AS JSONB),
                :override_uplift_pct,
                :voucher,
                :voucher_uplift_pct,
                CAST(:voucher_by_sku AS JSONB),
                :explanation,
                :start_month,
                :end_month,
                :start_date,
                :end_date,
                :is_active
            )
            RETURNING promotion_id
            """
        ),
        _write_params(conn, promotion),
    ).scalar_one()


def create_scenario_promotion(promotion: dict) -> dict:
    """Save a new Scenario promotion and return it as the list returns it."""

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_promotions", promotion.get("plan", "scenario"))
        promotion_id = insert_scenario_promotion(conn, promotion, has_plan)
        return _fetch_promotion(conn, promotion_id, has_plan)


def update_scenario_promotion(promotion_id: int, promotion: dict) -> dict | None:
    """Replace every field of a Scenario promotion; None when it doesn't exist."""

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_promotions", promotion.get("plan", "scenario"))
        updated = conn.execute(
            text(
                f"""
                UPDATE scenario_promotions

                SET
                    customer_id = :customer_id,
                    customer_ids = CAST(:customer_ids AS INTEGER[]),
                    excluded_pairs = CAST(:excluded_pairs AS JSONB),
                    references_by_customer = CAST(:references_by_customer AS JSONB),
                    sku_ranges = CAST(:sku_ranges AS TEXT[]),
                    sku = :sku,
                    promo_type = :promo_type,
                    mechanic_key = :mechanic_key,
                    mechanic_label = :mechanic_label,
                    reference_uplift_pct = :reference_uplift_pct,
                    reference_source = :reference_source,
                    reference_by_sku = CAST(:reference_by_sku AS JSONB),
                    override_uplift_pct = :override_uplift_pct,
                    voucher = :voucher,
                    voucher_uplift_pct = :voucher_uplift_pct,
                    voucher_by_sku = CAST(:voucher_by_sku AS JSONB),
                    explanation = :explanation,
                    start_month = :start_month,
                    end_month = :end_month,
                    start_date = :start_date,
                    end_date = :end_date,
                    is_active = :is_active,
                    updated_at = CURRENT_TIMESTAMP

                WHERE
                    promotion_id = :promotion_id
                    {"AND plan = :plan" if has_plan else ""}

                RETURNING promotion_id
                """
            ),
            {**_write_params(conn, promotion), "promotion_id": promotion_id},
        ).first()

        if updated is None:
            return None
        return _fetch_promotion(conn, promotion_id, has_plan)


def delete_scenario_promotion(promotion_id: int, plan: str = "scenario") -> bool:
    """Delete a Scenario promotion for good; False when it doesn't exist."""
    common.validate_plan(plan)

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_promotions", plan)
        deleted = conn.execute(
            text(
                f"""
                DELETE FROM scenario_promotions

                WHERE
                    promotion_id = :promotion_id
                    {"AND plan = :plan" if has_plan else ""}

                RETURNING promotion_id
                """
            ),
            {"promotion_id": promotion_id, "plan": plan},
        ).first()

    return deleted is not None
