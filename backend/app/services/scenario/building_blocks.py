from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.scenario import common


# Scenario builder building blocks (scenario_building_blocks): what-if
# uplifts that only move the Scenario builder's Simulated line. Nothing
# here reads or writes the forecast, Inventory or Dashboard data; the
# frontend applies a block to the Current forecast itself
# (app/utils/scenarioEngine.js). Requests name the customer and product
# the way the Forecast page does, and they are resolved to customer_id /
# sku here so the table holds real foreign keys.


# ============================================================
# READ
# ============================================================

# Joined back to names, so the page gets what it sent.
_BLOCK_SELECT = """
    SELECT
        block.block_id,
        customer.customer_name,
        block.sku,
        product.product_name,
        block.name,
        block.explanation,
        block.uplift_mode,
        block.uplift_value,
        block.start_month,
        block.end_month,
        block.is_active,
        block.created_at,
        block.updated_at

    FROM scenario_building_blocks AS block

    JOIN customers AS customer
        ON customer.customer_id = block.customer_id

    LEFT JOIN skus AS product
        ON product.sku = block.sku
"""


def _block_view(row: dict) -> dict:
    return {
        "block_id": row["block_id"],
        "customer_name": row["customer_name"],
        "sku": row["sku"],
        "product_name": row["product_name"],
        "name": row["name"],
        "explanation": row["explanation"],
        "uplift_mode": row["uplift_mode"],
        "uplift_value": float(row["uplift_value"]),
        "start_month": row["start_month"].isoformat(),
        "end_month": row["end_month"].isoformat(),
        "is_active": row["is_active"],
        "created_at": common.iso(row["created_at"]),
        "updated_at": common.iso(row["updated_at"]),
    }


def _fetch_block(conn: Connection, block_id: int) -> dict | None:
    row = conn.execute(
        text(
            f"""
            {_BLOCK_SELECT}

            WHERE
                block.block_id = :block_id
            """
        ),
        {"block_id": block_id},
    ).mappings().first()

    return _block_view(dict(row)) if row is not None else None


def list_building_blocks() -> list[dict]:
    """Every saved building block, newest first; the page filters them itself."""

    with common.read_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                {_BLOCK_SELECT}

                ORDER BY
                    block.created_at DESC,
                    block.block_id DESC
                """
            )
        ).mappings().all()

    return [_block_view(dict(row)) for row in rows]


# ============================================================
# NAME LOOKUPS
# ============================================================


def _resolve_customer_id(conn: Connection, customer_name: str) -> int:
    customer_id = conn.execute(
        text(
            """
            SELECT
                customer_id

            FROM customers

            WHERE
                customer_name = :customer_name
            """
        ),
        {"customer_name": customer_name},
    ).scalar()

    if customer_id is None:
        raise ValueError(f"Unknown customer: {customer_name}")
    return customer_id


def _resolve_sku(conn: Connection, product_name: str | None) -> str | None:
    """
    The sku for a product name, or None for "all SKUs". product_name is
    not unique in skus, so an archived duplicate gives way to the active
    one; two active SKUs with the name is refused rather than guessed.
    """

    if product_name is None:
        return None

    rows = conn.execute(
        text(
            """
            SELECT
                sku,
                is_active

            FROM skus

            WHERE
                product_name = :product_name
            """
        ),
        {"product_name": product_name},
    ).mappings().all()

    active = [row["sku"] for row in rows if row["is_active"]]
    candidates = active or [row["sku"] for row in rows]

    if not candidates:
        raise ValueError(f"Unknown product: {product_name}")
    if len(candidates) > 1:
        raise ValueError(
            f"More than one SKU is named {product_name} ({', '.join(sorted(candidates))}); "
            "rename one in the SKU catalogue first."
        )
    return candidates[0]


def _write_params(conn: Connection, block: dict) -> dict:
    return {
        "customer_id": _resolve_customer_id(conn, block["customer_name"]),
        "sku": _resolve_sku(conn, block["product_name"]),
        "name": block["name"],
        "explanation": block["explanation"],
        "uplift_mode": block["uplift_mode"],
        "uplift_value": block["uplift_value"],
        "start_month": block["start_month"],
        "end_month": block["end_month"],
        "is_active": block["is_active"],
    }


# ============================================================
# WRITES
#
# `block` is a ScenarioBuildingBlockCreate/Update dumped to a dict,
# already validated. Each write is one transaction.
# ============================================================


def create_building_block(block: dict) -> dict:
    """Save a new building block and return it as the list returns it."""

    with common.get_engine().begin() as conn:
        block_id = conn.execute(
            text(
                """
                INSERT INTO scenario_building_blocks (
                    customer_id,
                    sku,
                    name,
                    explanation,
                    uplift_mode,
                    uplift_value,
                    start_month,
                    end_month,
                    is_active
                )
                VALUES (
                    :customer_id,
                    :sku,
                    :name,
                    :explanation,
                    :uplift_mode,
                    :uplift_value,
                    :start_month,
                    :end_month,
                    :is_active
                )
                RETURNING block_id
                """
            ),
            _write_params(conn, block),
        ).scalar_one()

        return _fetch_block(conn, block_id)


def update_building_block(block_id: int, block: dict) -> dict | None:
    """Replace every field of a building block; None when it doesn't exist."""

    with common.get_engine().begin() as conn:
        updated = conn.execute(
            text(
                """
                UPDATE scenario_building_blocks

                SET
                    customer_id = :customer_id,
                    sku = :sku,
                    name = :name,
                    explanation = :explanation,
                    uplift_mode = :uplift_mode,
                    uplift_value = :uplift_value,
                    start_month = :start_month,
                    end_month = :end_month,
                    is_active = :is_active,
                    updated_at = CURRENT_TIMESTAMP

                WHERE
                    block_id = :block_id

                RETURNING block_id
                """
            ),
            {**_write_params(conn, block), "block_id": block_id},
        ).first()

        if updated is None:
            return None
        return _fetch_block(conn, block_id)


def delete_building_block(block_id: int) -> bool:
    """Delete a building block for good; False when it doesn't exist."""

    with common.get_engine().begin() as conn:
        deleted = conn.execute(
            text(
                """
                DELETE FROM scenario_building_blocks

                WHERE
                    block_id = :block_id

                RETURNING block_id
                """
            ),
            {"block_id": block_id},
        ).first()

    return deleted is not None
