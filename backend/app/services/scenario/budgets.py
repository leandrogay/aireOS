import json
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.schemas.scenario.building_blocks import ScenarioBuildingBlockCreate
from app.schemas.scenario.promotions import ScenarioPromotionCreate
from app.services import bigquery
from app.services.scenario import building_blocks, common, initial_breakdown, promotions
from app.services.scenario.budget_calc import calculate_budget


# A year's budget is drafted in the Budget planning entries (plan 'budget',
# scoped to the year by their months) and frozen by a lock into a numbered
# version. One version per year is official (migration 030): the Budget line
# on Forecast and Inventory. Any version can be copied back into the entries
# to edit and lock again, or the entries cleared to start from Initial alone.
# Deleting a version in the app only hides it (migration 031): it is kept for
# the record, but never listed, compared, copied or made official again.


class OfficialBudgetDeleteError(Exception):
    """The official version can't be deleted; another must be made official first."""


def _validate_year(year: int) -> None:
    if not 2000 <= year <= 2100:
        raise ValueError("year must be between 2000 and 2100")


def _make_official(conn: Connection, year: int, snapshot_id: int) -> None:
    # Two statements: the one-official-per-year index is checked row by row.
    conn.execute(text("UPDATE budget_snapshots SET is_official = FALSE WHERE year = :year AND is_official"), {"year": year})
    conn.execute(text("UPDATE budget_snapshots SET is_official = TRUE WHERE snapshot_id = :snapshot_id"), {"snapshot_id": snapshot_id})


def lock_budget(year: int, locked_by: str, name: str | None = None, make_official: bool = True) -> dict:
    """
    Append a whole-year snapshot, calculated on the server from Initial and
    the year's saved budget entries. It becomes the official version when
    asked, or when the year has none yet.
    """
    _validate_year(year)
    with common.read_connection() as conn:
        common.require_budget_schema(conn)
    rows = bigquery.get_forecast_output_rows(start_date=f"{year}-01-01", end_date=f"{year}-12-01", tier=bigquery.DEFAULT_FORECAST_TIER)
    breakdown = initial_breakdown.get_initial_breakdown(year, forecast_rows=rows)
    if breakdown["unavailable"]:
        raise ValueError("Initial's promotion breakdown is unavailable: " + breakdown["unavailable"][0]["reason"])
    with common.get_engine().begin() as conn:
        # Serialize version allocation; share locks keep the copied inputs stable.
        conn.execute(text("SELECT pg_advisory_xact_lock(26000, :year)"), {"year": year})
        conn.execute(text("LOCK TABLE scenario_building_blocks, scenario_promotions IN SHARE MODE"))
        block_condition, year_params = common.year_scope("block", year)
        promotion_condition, _ = common.year_scope("promotion", year)
        blocks = [building_blocks._block_view(dict(row)) for row in conn.execute(
            text(building_blocks._BLOCK_SELECT + f" WHERE block.plan = 'budget' {block_condition}"), year_params
        ).mappings().all()]
        promos = [promotions._promotion_view(dict(row)) for row in conn.execute(
            text(promotions._PROMOTION_SELECT + f" WHERE promotion.plan = 'budget' {promotion_condition}"), year_params
        ).mappings().all()]
        frozen = calculate_budget(rows, blocks, promos, year, breakdown["rows"])
        snapshot = dict(conn.execute(text("""
            INSERT INTO budget_snapshots (year, version, name, locked_by, inputs)
            SELECT :year, COALESCE(MAX(version), 0) + 1, :name, :locked_by, CAST(:inputs AS JSONB)
            FROM budget_snapshots WHERE year = :year
            RETURNING snapshot_id, year, version, name, locked_at, locked_by
        """), {"year": year, "name": name, "locked_by": locked_by, "inputs": json.dumps({"blocks": blocks, "promotions": promos,
            "initial_breakdown": breakdown,
            "initial_stamps": sorted({row["initial_generated_at"] for row in rows if row.get("initial_generated_at")})})}).mappings().first())
        conn.execute(text("""
            INSERT INTO budget_snapshot_rows
                (snapshot_id, customer_id, customer_name, sku, product_name, sku_range, month_year, units)
            VALUES (:snapshot_id, :customer_id, :customer_name, :sku, :product_name, :sku_range, :month_year, :units)
        """), [{"snapshot_id": snapshot["snapshot_id"], **{key: row.get(key) for key in
            ("customer_id", "customer_name", "sku", "product_name", "sku_range", "month_year", "units")}} for row in frozen])
        has_official = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM budget_snapshots WHERE year = :year AND is_official)"
        ), {"year": year}).scalar()
        official = make_official or not has_official
        if official:
            _make_official(conn, year, snapshot["snapshot_id"])
    return {**snapshot, "is_official": official, "locked_at": common.iso(snapshot["locked_at"]), "row_count": len(frozen)}


def set_official(year: int, version: int) -> dict | None:
    """Make one locked version the year's official budget; None when it doesn't exist or was deleted."""
    _validate_year(year)
    with common.get_engine().begin() as conn:
        common.require_budget_schema(conn)
        conn.execute(text("SELECT pg_advisory_xact_lock(26000, :year)"), {"year": year})
        snapshot = conn.execute(text("""
            SELECT snapshot_id, year, version, name, locked_at, locked_by FROM budget_snapshots
            WHERE year = :year AND version = :version AND deleted_at IS NULL
        """), {"year": year, "version": version}).mappings().first()
        if snapshot is None:
            return None
        _make_official(conn, year, snapshot["snapshot_id"])
    return {**dict(snapshot), "is_official": True, "locked_at": common.iso(snapshot["locked_at"])}


def delete_version(year: int, version: int, deleted_by: str) -> bool:
    """
    Hide a locked version from the app (who and when are recorded); its
    units stay in the database. False when it doesn't exist or is already
    deleted. The official version is refused.
    """
    _validate_year(year)
    with common.get_engine().begin() as conn:
        common.require_budget_schema(conn)
        conn.execute(text("SELECT pg_advisory_xact_lock(26000, :year)"), {"year": year})
        snapshot = conn.execute(text("""
            SELECT snapshot_id, is_official FROM budget_snapshots
            WHERE year = :year AND version = :version AND deleted_at IS NULL
        """), {"year": year, "version": version}).mappings().first()
        if snapshot is None:
            return False
        if snapshot["is_official"]:
            raise OfficialBudgetDeleteError("The official budget can't be deleted. Make another version official first.")
        conn.execute(text("""
            UPDATE budget_snapshots SET deleted_at = CURRENT_TIMESTAMP, deleted_by = :deleted_by
            WHERE snapshot_id = :snapshot_id
        """), {"snapshot_id": snapshot["snapshot_id"], "deleted_by": deleted_by})
    return True


def _in_year(item: dict, year: int) -> bool:
    return item["start_month"] <= f"{year}-12-01" and item["end_month"] >= f"{year}-01-01"


def _create_fields(schema, item: dict) -> dict:
    # A saved entry as its create request: validated again, dates parsed.
    fields = {key: item[key] for key in schema.model_fields if key in item and key != "plan"}
    return schema(**fields, plan="budget").model_dump()


def start_budget(year: int, version: int | None) -> dict | None:
    """
    Replace a year's budget entries in one transaction: with a copy of a
    locked version's entries, to edit and lock again, or with none (start
    from scratch, Initial alone). Locked versions never change. None when
    the version doesn't exist.
    """
    _validate_year(year)
    with common.get_engine().begin() as conn:
        common.require_budget_schema(conn)
        conn.execute(text("SELECT pg_advisory_xact_lock(26000, :year)"), {"year": year})
        inputs = {}
        if version is not None:
            inputs = conn.execute(text(
                "SELECT inputs FROM budget_snapshots WHERE year = :year AND version = :version AND deleted_at IS NULL"
            ), {"year": year, "version": version}).scalar()
            if inputs is None:
                return None
            if isinstance(inputs, str):
                inputs = json.loads(inputs)
        block_condition, year_params = common.year_scope("block", year)
        promotion_condition, _ = common.year_scope("promotion", year)
        conn.execute(text(f"DELETE FROM scenario_building_blocks AS block WHERE block.plan = 'budget' {block_condition}"), year_params)
        conn.execute(text(f"DELETE FROM scenario_promotions AS promotion WHERE promotion.plan = 'budget' {promotion_condition}"), year_params)
        # Locks made before entries were scoped by year saved every year's entries.
        blocks = [block for block in inputs.get("blocks", []) if _in_year(block, year)]
        promos = [promotion for promotion in inputs.get("promotions", []) if _in_year(promotion, year)]
        for block in blocks:
            building_blocks.insert_building_block(conn, _create_fields(ScenarioBuildingBlockCreate, block))
        for promotion in promos:
            promotions.insert_scenario_promotion(conn, _create_fields(ScenarioPromotionCreate, promotion))
    return {"year": year, "version": version, "blocks": len(blocks), "promotions": len(promos)}


def read_budgets(year: int | None = None, version: int | None = None) -> dict:
    """History (deleted versions left out) plus rows of each year's official version, or of one version of a year."""
    if version is not None and year is None:
        raise ValueError("Choose a year when requesting a version.")
    with common.read_connection() as conn:
        if not common.has_budget_tables(conn):
            if year is not None:
                raise common.BudgetSetupRequiredError(common.BUDGET_SETUP_DETAIL)
            return {"history": [], "rows": [], "setup_required": True, "message": common.BUDGET_SETUP_DETAIL}
        history = [dict(row) for row in conn.execute(text("""
            SELECT snapshot_id, year, version, name, is_official, locked_at, locked_by,
                (SELECT COALESCE(SUM(units), 0) FROM budget_snapshot_rows r WHERE r.snapshot_id = s.snapshot_id) AS total_units
            FROM budget_snapshots s
            WHERE (CAST(:year AS INTEGER) IS NULL OR year = :year) AND deleted_at IS NULL
            ORDER BY year DESC, version DESC
        """), {"year": year}).mappings().all()]
        chosen = {}
        for item in history:
            wanted = item["is_official"] if version is None else item["version"] == version
            if wanted:
                chosen[item["year"]] = item["snapshot_id"]
        rows = conn.execute(text("""
            SELECT r.*, COALESCE(c.customer_name, r.customer_name) AS current_customer_name,
                COALESCE(p.product_name, r.product_name) AS current_product_name,
                CASE WHEN p.sku IS NULL THEN r.sku_range ELSE p.sku_range END AS current_sku_range
            FROM budget_snapshot_rows r LEFT JOIN customers c ON c.customer_id = r.customer_id
            LEFT JOIN skus p ON p.sku = r.sku
            WHERE snapshot_id = ANY(:ids) ORDER BY r.month_year, r.customer_id, r.sku
        """), {"ids": list(chosen.values())}).mappings().all() if chosen else []
    return {"history": [{**item, "locked_at": common.iso(item["locked_at"]), "total_units": float(item.get("total_units") or 0)} for item in history],
            "rows": [{**dict(row), "customer_name": row["current_customer_name"], "product_name": row["current_product_name"],
                      "sku_range": row["current_sku_range"], "month_year": row["month_year"].isoformat(), "units": float(row["units"])} for row in rows]}


def sellout_for_customer(conn: Connection, customer_id: int) -> dict[str, dict[date, float]]:
    """Each year's official locked sell-out for Inventory, keyed by stable SKU code."""
    if not common.has_budget_tables(conn):
        return {}
    rows = conn.execute(text("""
        SELECT r.sku, r.month_year, r.units FROM budget_snapshot_rows r
        JOIN budget_snapshots s USING (snapshot_id)
        WHERE s.is_official AND r.customer_id = :customer_id
    """), {"customer_id": customer_id}).mappings().all()
    result = {}
    for row in rows:
        result.setdefault(row["sku"], {})[row["month_year"]] = float(row["units"])
    return result
