from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.scenario import common


# Scenario builder building blocks (scenario_building_blocks): what-if
# uplifts that move the Scenario builder's Simulated line, and the sell-in
# plan chart's building blocks overlay when picked there. Nothing here reads
# or writes the forecast, Inventory or Dashboard data; the Scenario builder
# applies a block to the Current forecast itself (app/utils/scenarioEngine.js),
# the overlay through scenario/block_effects. Requests name the customer and product
# the way the Forecast page does, and they are resolved to customer_id /
# sku here so the table holds real foreign keys.
#
# Blocks follow SKU ranges (migration 017): sku_ranges = every SKU of those
# ranges, sku and sku_ranges both NULL = every SKU ("All SKU ranges"), and
# sku alone = one SKU, kept for blocks saved before ranges.
#
# kind = 'growth' marks the budget's year-on-year growth: a % block on one
# SKU range from January to December (the schema checks the shape), one per
# customer x range x year. It is applied exactly like any other % block.


class GrowthBlockExistsError(Exception):
    """The customer already has a growth block for that SKU range and year."""


# ============================================================
# READ
# ============================================================

# Joined back to names, so the page gets what it sent.
_BLOCK_SELECT = """
    SELECT
        block.block_id,
        block.kind,
        customer.customer_name,
        block.sku_ranges,
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
        "kind": row["kind"],
        "customer_name": row["customer_name"],
        "sku_ranges": list(row["sku_ranges"]) if row["sku_ranges"] else None,
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


def fetch_blocks_for_customer(conn: Connection, customer_id: int, block_ids: list[int]) -> list[dict]:
    """
    The picked blocks that belong to this customer, as the sell-in plan's
    building blocks overlay applies them (scenario/block_effects): sku is a
    single SKU's code, range_skus the codes of the block's SKU range (both
    None = every SKU), months are dates. A picked block of another customer,
    or one deleted since, is simply not returned. Whether a block is switched
    on in the Scenario builder doesn't matter: the overlay is picked by hand.
    """

    if not block_ids:
        return []
    rows = conn.execute(
        text(
            """
            SELECT
                block.block_id,
                block.sku,
                block.sku_ranges,
                CASE
                    WHEN block.sku_ranges IS NULL THEN NULL
                    ELSE ARRAY(
                        SELECT product.sku
                        FROM skus AS product
                        WHERE product.sku_range = ANY(block.sku_ranges)
                        ORDER BY product.sku
                    )
                END AS range_skus,
                block.name,
                block.uplift_mode,
                block.uplift_value,
                block.start_month,
                block.end_month

            FROM scenario_building_blocks AS block

            WHERE
                block.customer_id = :customer_id
                AND block.block_id = ANY(:block_ids)

            ORDER BY
                block.block_id
            """
        ),
        {"customer_id": customer_id, "block_ids": list(block_ids)},
    ).mappings().all()

    return [{**dict(row), "uplift_value": float(row["uplift_value"])} for row in rows]


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


def _resolve_sku_ranges(conn: Connection, sku_ranges: list[str] | None) -> list[str] | None:
    """
    The SKU ranges as stored, or None for "all SKU ranges"; every one must be
    in the catalogue. Rows whose sku equals their sku_range are leftover
    range-name inserts, not products, so they don't make a range real (same
    rule as catalog_service.get_sku_ranges).
    """

    if not sku_ranges:
        return None

    found = {
        row[0]
        for row in conn.execute(
            text(
                """
                SELECT DISTINCT
                    sku_range

                FROM skus

                WHERE
                    sku_range = ANY(:sku_ranges)
                    AND sku IS DISTINCT FROM sku_range
                """
            ),
            {"sku_ranges": list(sku_ranges)},
        ).all()
    }

    unknown = [name for name in sku_ranges if name not in found]
    if unknown:
        raise ValueError(f"Unknown SKU range: {', '.join(unknown)}")
    return list(sku_ranges)


def _ensure_one_growth_per_year(conn: Connection, block: dict, params: dict, block_id: int | None) -> None:
    """
    Refuse a second growth block for the customer's SKU range and year, so
    the page gets a clear 409 instead of the unique index's error (the index
    stays the backstop). The block being updated doesn't count against itself.
    """

    if params["kind"] != "growth":
        return

    existing = conn.execute(
        text(
            """
            SELECT
                block_id

            FROM scenario_building_blocks

            WHERE
                kind = 'growth'
                AND customer_id = :customer_id
                AND sku_ranges[1] = :sku_range
                AND start_month = :start_month
                AND block_id <> :block_id
            """
        ),
        {
            "customer_id": params["customer_id"],
            # A growth names exactly one range (the schema checks).
            "sku_range": params["sku_ranges"][0],
            "start_month": params["start_month"],
            # BIGSERIAL starts at 1, so 0 excludes nothing on a create.
            "block_id": block_id or 0,
        },
    ).first()

    if existing is not None:
        raise GrowthBlockExistsError(
            f"{block['customer_name']} already has growth for {params['sku_ranges'][0]} in {params['start_month'].year}; "
            "edit that one instead."
        )


def _write_params(conn: Connection, block: dict) -> dict:
    return {
        "kind": block["kind"],
        "customer_id": _resolve_customer_id(conn, block["customer_name"]),
        "sku_ranges": _resolve_sku_ranges(conn, block["sku_ranges"]),
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
        params = _write_params(conn, block)
        _ensure_one_growth_per_year(conn, block, params, None)

        block_id = conn.execute(
            text(
                """
                INSERT INTO scenario_building_blocks (
                    kind,
                    customer_id,
                    sku_ranges,
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
                    :kind,
                    :customer_id,
                    CAST(:sku_ranges AS TEXT[]),
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
            params,
        ).scalar_one()

        return _fetch_block(conn, block_id)


def update_building_block(block_id: int, block: dict) -> dict | None:
    """Replace every field of a building block; None when it doesn't exist."""

    with common.get_engine().begin() as conn:
        params = _write_params(conn, block)
        _ensure_one_growth_per_year(conn, block, params, block_id)

        updated = conn.execute(
            text(
                """
                UPDATE scenario_building_blocks

                SET
                    kind = :kind,
                    customer_id = :customer_id,
                    sku_ranges = CAST(:sku_ranges AS TEXT[]),
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
            {**params, "block_id": block_id},
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
