
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.scenario import building_blocks, common


# Scenario builder promotions (scenario_promotions, migration 007): planned
# promotions that only move the Scenario builder's Simulated line, saved
# and switched on/off exactly like building blocks (building_blocks.py).
# Nothing here reads or writes the forecast, the real `promotions` table,
# Inventory or Dashboard; the frontend applies a promotion to the Current
# forecast itself (app/utils/scenarioPromotions.js).
#
# Uplift values arrive in the body as the page copied them from Promotion
# Uplift Settings and are stored as sent: a later settings change (an
# edit, a moved anchor, measured values) never moves a saved promotion.


# ============================================================
# READ
# ============================================================

_PROMOTION_SELECT = """
    SELECT
        promotion.promotion_id,
        customer.customer_name,
        promotion.sku,
        product.product_name,
        promotion.promo_type,
        promotion.mechanic_key,
        promotion.mechanic_label,
        promotion.reference_uplift_pct,
        promotion.reference_source,
        promotion.override_uplift_pct,
        promotion.voucher,
        promotion.voucher_uplift_pct,
        promotion.explanation,
        promotion.start_month,
        promotion.end_month,
        promotion.start_date,
        promotion.end_date,
        promotion.is_active,
        promotion.created_at,
        promotion.updated_at

    FROM scenario_promotions AS promotion

    JOIN customers AS customer
        ON customer.customer_id = promotion.customer_id

    LEFT JOIN skus AS product
        ON product.sku = promotion.sku
"""


def _number(value) -> float | None:
    return float(value) if value is not None else None


def _promotion_view(row: dict) -> dict:
    return {
        "promotion_id": row["promotion_id"],
        "customer_name": row["customer_name"],
        "sku": row["sku"],
        "product_name": row["product_name"],
        "promo_type": row["promo_type"],
        "mechanic_key": row["mechanic_key"],
        "mechanic_label": row["mechanic_label"],
        "reference_uplift_pct": float(row["reference_uplift_pct"]),
        "reference_source": row["reference_source"],
        "override_uplift_pct": _number(row["override_uplift_pct"]),
        "voucher": row["voucher"],
        "voucher_uplift_pct": float(row["voucher_uplift_pct"]),
        "explanation": row["explanation"],
        "start_month": row["start_month"].isoformat(),
        "end_month": row["end_month"].isoformat(),
        "start_date": row["start_date"].isoformat() if row["start_date"] else None,
        "end_date": row["end_date"].isoformat() if row["end_date"] else None,
        "is_active": row["is_active"],
        "created_at": common.iso(row["created_at"]),
        "updated_at": common.iso(row["updated_at"]),
    }


def _fetch_promotion(conn: Connection, promotion_id: int) -> dict | None:
    row = conn.execute(
        text(
            f"""
            {_PROMOTION_SELECT}

            WHERE
                promotion.promotion_id = :promotion_id
            """
        ),
        {"promotion_id": promotion_id},
    ).mappings().first()

    return _promotion_view(dict(row)) if row is not None else None


def list_scenario_promotions() -> list[dict]:
    """Every saved Scenario promotion, newest first; the page filters them itself."""

    with common.read_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                {_PROMOTION_SELECT}

                ORDER BY
                    promotion.created_at DESC,
                    promotion.promotion_id DESC
                """
            )
        ).mappings().all()

    return [_promotion_view(dict(row)) for row in rows]


# ============================================================
# WRITE PARAMETERS
# ============================================================


def _write_params(conn: Connection, promotion: dict) -> dict:
    # Same name lookups as building blocks, so both kinds of item resolve
    # a customer or product the same way.
    return {
        "customer_id": building_blocks._resolve_customer_id(conn, promotion["customer_name"]),
        "sku": building_blocks._resolve_sku(conn, promotion["product_name"]),
        "promo_type": promotion["promo_type"],
        "mechanic_key": promotion["mechanic_key"],
        "mechanic_label": promotion["mechanic_label"],
        "reference_uplift_pct": promotion["reference_uplift_pct"],
        "reference_source": promotion["reference_source"],
        "override_uplift_pct": promotion["override_uplift_pct"],
        "voucher": promotion["voucher"],
        "voucher_uplift_pct": promotion["voucher_uplift_pct"],
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


def create_scenario_promotion(promotion: dict) -> dict:
    """Save a new Scenario promotion and return it as the list returns it."""

    with common.get_engine().begin() as conn:
        promotion_id = conn.execute(
            text(
                """
                INSERT INTO scenario_promotions (
                    customer_id,
                    sku,
                    promo_type,
                    mechanic_key,
                    mechanic_label,
                    reference_uplift_pct,
                    reference_source,
                    override_uplift_pct,
                    voucher,
                    voucher_uplift_pct,
                    explanation,
                    start_month,
                    end_month,
                    start_date,
                    end_date,
                    is_active
                )
                VALUES (
                    :customer_id,
                    :sku,
                    :promo_type,
                    :mechanic_key,
                    :mechanic_label,
                    :reference_uplift_pct,
                    :reference_source,
                    :override_uplift_pct,
                    :voucher,
                    :voucher_uplift_pct,
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

        return _fetch_promotion(conn, promotion_id)


def update_scenario_promotion(promotion_id: int, promotion: dict) -> dict | None:
    """Replace every field of a Scenario promotion; None when it doesn't exist."""

    with common.get_engine().begin() as conn:
        updated = conn.execute(
            text(
                """
                UPDATE scenario_promotions

                SET
                    customer_id = :customer_id,
                    sku = :sku,
                    promo_type = :promo_type,
                    mechanic_key = :mechanic_key,
                    mechanic_label = :mechanic_label,
                    reference_uplift_pct = :reference_uplift_pct,
                    reference_source = :reference_source,
                    override_uplift_pct = :override_uplift_pct,
                    voucher = :voucher,
                    voucher_uplift_pct = :voucher_uplift_pct,
                    explanation = :explanation,
                    start_month = :start_month,
                    end_month = :end_month,
                    start_date = :start_date,
                    end_date = :end_date,
                    is_active = :is_active,
                    updated_at = CURRENT_TIMESTAMP

                WHERE
                    promotion_id = :promotion_id

                RETURNING promotion_id
                """
            ),
            {**_write_params(conn, promotion), "promotion_id": promotion_id},
        ).first()

        if updated is None:
            return None
        return _fetch_promotion(conn, promotion_id)


def delete_scenario_promotion(promotion_id: int) -> bool:
    """Delete a Scenario promotion for good; False when it doesn't exist."""

    with common.get_engine().begin() as conn:
        deleted = conn.execute(
            text(
                """
                DELETE FROM scenario_promotions

                WHERE
                    promotion_id = :promotion_id

                RETURNING promotion_id
                """
            ),
            {"promotion_id": promotion_id},
        ).first()

    return deleted is not None
