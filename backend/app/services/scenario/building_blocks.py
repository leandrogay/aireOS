import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.scenario import common


# Scenario builder building blocks (scenario_building_blocks): what-if
# uplifts that move the Scenario builder's Simulated line, and the sell-in
# plan chart's building blocks overlay when picked there. Nothing here reads
# or writes the forecast, Inventory or Dashboard data; the Scenario builder
# applies a block to the Current forecast itself (app/utils/scenarioEngine.js),
# the overlay through scenario/block_effects. Requests name the customers and product
# the way the Forecast page does, and they are resolved to customer_ids /
# sku here.
#
# A block can cover several customers (migration 025): customer_ids = those
# customers, NULL = every customer. customer_id is also filled when it names
# exactly one (growth always does), for the growth index and ON DELETE CASCADE;
# customer_service.delete_customer takes a deleted customer out of the lists.
#
# Each customer x SKU range a block covers can be switched off on its own
# (excluded_pairs, migration 026: [{customer_id, sku_range}], sku_range null
# = the SKUs with no range); the block stays one entry.
#
# Blocks follow SKU ranges (migration 020): sku_ranges = every SKU of those
# ranges, sku and sku_ranges both NULL = every SKU ("All SKU ranges"), and
# sku alone = one SKU, kept for blocks saved before ranges.
#
# kind = 'growth' marks the budget's year-on-year growth: a % block on every
# SKU of one customer from January to December (the schema checks the shape),
# one per customer x year (migration 027). It is applied exactly like any
# other % block.


class GrowthBlockExistsError(Exception):
    """The customer already has a growth block for that year."""


# ============================================================
# READ
# ============================================================

# Joined back to names, so the page gets what it sent.
_BLOCK_SELECT = f"""
    SELECT
        block.block_id,
        block.plan,
        block.kind,
        {common.customer_names_select("block")},
        block.sku_ranges,
        {common.excluded_pairs_select("block")},
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

    LEFT JOIN skus AS product
        ON product.sku = block.sku
"""


def _block_view(row: dict) -> dict:
    return {
        "block_id": row["block_id"],
        "plan": row.get("plan", "scenario"),
        "kind": row["kind"],
        # None = every customer, as sku_ranges.
        "customer_names": list(row["customer_names"]) or None,
        "sku_ranges": list(row["sku_ranges"]) if row["sku_ranges"] else None,
        "excluded_pairs": list(row["excluded_pairs"] or []),
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


def _select_for_schema(has_plan: bool) -> str:
    return _BLOCK_SELECT if has_plan else _BLOCK_SELECT.replace("block.plan,", "'scenario' AS plan,")


def _fetch_block(conn: Connection, block_id: int, has_plan: bool = True) -> dict | None:
    row = conn.execute(
        text(
            f"""
            {_select_for_schema(has_plan)}

            WHERE
                block.block_id = :block_id
            """
        ),
        {"block_id": block_id},
    ).mappings().first()

    return _block_view(dict(row)) if row is not None else None


def list_building_blocks(plan: str = "scenario", year: int | None = None) -> list[dict]:
    """Every saved building block of a plan (or of one budget year), newest first; the page filters them itself."""
    common.validate_plan(plan)

    with common.read_connection() as conn:
        has_plan = common.require_plan(conn, "scenario_building_blocks", plan)
        scope = "block.plan = :plan" if has_plan else "TRUE"
        # Budget planning reads one year's entries at a time.
        year_condition, year_params = common.year_scope("block", year)
        rows = conn.execute(
            text(
                f"""
                {_select_for_schema(has_plan)}

                WHERE {scope} {year_condition}

                ORDER BY
                    block.created_at DESC,
                    block.block_id DESC
                """
            ),
            {"plan": plan, **year_params},
        ).mappings().all()

    return [_block_view(dict(row)) for row in rows]


def fetch_blocks_for_customer(conn: Connection, customer_id: int, block_ids: list[int]) -> list[dict]:
    """
    The picked blocks that cover this customer (it is in customer_ids, or
    they cover every customer), as the sell-in plan's
    building blocks overlay applies them (scenario/block_effects): sku is a
    single SKU's code, range_skus the codes of the block's SKU range (both
    None = every SKU), excluded_skus the SKUs of this customer's switched-off
    ranges, months are dates. A picked block of another customer,
    or one deleted since, is simply not returned. Whether a block is switched
    on in the Scenario builder doesn't matter: the overlay is picked by hand.
    """

    if not block_ids:
        return []
    has_plan = common.require_plan(conn, "scenario_building_blocks", "scenario")
    plan_scope = "AND block.plan = 'scenario'" if has_plan else ""
    rows = conn.execute(
        text(
            f"""
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
                -- This customer's switched-off SKU ranges, as SKU codes.
                ARRAY(
                    SELECT product.sku
                    FROM skus AS product
                    WHERE EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(block.excluded_pairs) AS pair
                        WHERE (pair ->> 'customer_id')::INTEGER = CAST(:customer_id AS INTEGER)
                            AND product.sku_range IS NOT DISTINCT FROM pair ->> 'sku_range'
                    )
                    ORDER BY product.sku
                ) AS excluded_skus,
                block.name,
                block.uplift_mode,
                block.uplift_value,
                block.start_month,
                block.end_month

            FROM scenario_building_blocks AS block

            WHERE
                (block.customer_ids IS NULL OR CAST(:customer_id AS INTEGER) = ANY(block.customer_ids))
                {plan_scope}
                AND block.block_id = ANY(:block_ids)

            ORDER BY
                block.block_id
            """
        ),
        {"customer_id": customer_id, "block_ids": list(block_ids)},
    ).mappings().all()

    return [
        {**dict(row), "uplift_value": float(row["uplift_value"]), "excluded_skus": list(row["excluded_skus"] or [])}
        for row in rows
    ]


# ============================================================
# NAME LOOKUPS
# ============================================================


def resolve_customer_ids(conn: Connection, customer_names: list[str] | None) -> list[int] | None:
    """The customers' ids in the order named, or None for every customer; every name must exist."""

    if not customer_names:
        return None

    found = {
        row["customer_name"]: row["customer_id"]
        for row in conn.execute(
            text(
                """
                SELECT
                    customer_id,
                    customer_name

                FROM customers

                WHERE
                    customer_name = ANY(:customer_names)
                """
            ),
            {"customer_names": list(customer_names)},
        ).mappings().all()
    }

    unknown = [name for name in customer_names if name not in found]
    if unknown:
        raise ValueError(f"Unknown customer: {', '.join(unknown)}")
    return [found[name] for name in customer_names]


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


def _ensure_one_growth_per_year(conn: Connection, block: dict, params: dict, block_id: int | None, has_plan: bool = True) -> None:
    """
    Refuse a second growth block for the customer and year, so
    the page gets a clear 409 instead of the unique index's error (the index
    stays the backstop). The block being updated doesn't count against itself.
    """

    if params["kind"] != "growth":
        return

    plan_scope = "AND plan = :plan" if has_plan else ""
    existing = conn.execute(
        text(
            f"""
            SELECT
                block_id

            FROM scenario_building_blocks

            WHERE
                kind = 'growth'
                {plan_scope}
                AND customer_id = :customer_id
                AND start_month = :start_month
                AND block_id <> :block_id
            """
        ),
        {
            "plan": params["plan"],
            "customer_id": params["customer_id"],
            "start_month": params["start_month"],
            # BIGSERIAL starts at 1, so 0 excludes nothing on a create.
            "block_id": block_id or 0,
        },
    ).first()

    if existing is not None:
        raise GrowthBlockExistsError(
            f"{block['customer_names'][0]} already has growth for {params['start_month'].year}; "
            "edit that one instead."
        )


def excluded_pairs_json(conn: Connection, pairs: list[dict]) -> str:
    """The switched-off pairs as stored: customer ids (every name must exist), sku_range None for no range."""

    names = sorted({pair["customer_name"] for pair in pairs})
    ids = dict(zip(names, resolve_customer_ids(conn, names) or []))
    return json.dumps(
        [{"customer_id": ids[pair["customer_name"]], "sku_range": pair["sku_range"] or None} for pair in pairs]
    )


def _write_params(conn: Connection, block: dict) -> dict:
    customer_ids = resolve_customer_ids(conn, block["customer_names"])
    return {
        "plan": block.get("plan", "scenario"),
        "kind": block["kind"],
        "customer_ids": customer_ids,
        # The one customer, or None for several or every customer.
        "customer_id": customer_ids[0] if customer_ids and len(customer_ids) == 1 else None,
        "sku_ranges": _resolve_sku_ranges(conn, block["sku_ranges"]),
        "excluded_pairs": excluded_pairs_json(conn, block["excluded_pairs"]),
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


def insert_building_block(conn: Connection, block: dict, has_plan: bool = True) -> int:
    """Insert one building block inside the caller's transaction; its new id. Budget versions copy blocks back through it."""
    params = _write_params(conn, block)
    _ensure_one_growth_per_year(conn, block, params, None, has_plan)

    plan_column = "plan," if has_plan else ""
    plan_value = ":plan," if has_plan else ""
    return conn.execute(
        text(
            f"""
            INSERT INTO scenario_building_blocks (
                {plan_column}
                kind,
                customer_id,
                customer_ids,
                sku_ranges,
                excluded_pairs,
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
                {plan_value}
                :kind,
                :customer_id,
                CAST(:customer_ids AS INTEGER[]),
                CAST(:sku_ranges AS TEXT[]),
                CAST(:excluded_pairs AS JSONB),
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


def create_building_block(block: dict) -> dict:
    """Save a new building block and return it as the list returns it."""

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_building_blocks", block.get("plan", "scenario"))
        block_id = insert_building_block(conn, block, has_plan)
        return _fetch_block(conn, block_id, has_plan)


def update_building_block(block_id: int, block: dict) -> dict | None:
    """Replace every field of a building block; None when it doesn't exist."""

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_building_blocks", block.get("plan", "scenario"))
        params = _write_params(conn, block)
        _ensure_one_growth_per_year(conn, block, params, block_id, has_plan)

        updated = conn.execute(
            text(
                f"""
                UPDATE scenario_building_blocks

                SET
                    kind = :kind,
                    customer_id = :customer_id,
                    customer_ids = CAST(:customer_ids AS INTEGER[]),
                    sku_ranges = CAST(:sku_ranges AS TEXT[]),
                    excluded_pairs = CAST(:excluded_pairs AS JSONB),
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
                    {"AND plan = :plan" if has_plan else ""}

                RETURNING block_id
                """
            ),
            {**params, "block_id": block_id},
        ).first()

        if updated is None:
            return None
        return _fetch_block(conn, block_id, has_plan)


def delete_building_block(block_id: int, plan: str = "scenario") -> bool:
    """Delete a building block for good; False when it doesn't exist."""
    common.validate_plan(plan)

    with common.get_engine().begin() as conn:
        has_plan = common.require_plan(conn, "scenario_building_blocks", plan)
        deleted = conn.execute(
            text(
                f"""
                DELETE FROM scenario_building_blocks

                WHERE
                    block_id = :block_id
                    {"AND plan = :plan" if has_plan else ""}

                RETURNING block_id
                """
            ),
            {"block_id": block_id, "plan": plan},
        ).first()

    return deleted is not None
