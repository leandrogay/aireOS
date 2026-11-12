import json
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services import bigquery
from app.services.scenario import building_blocks, common, initial_breakdown, promotions
from app.services.scenario.budget_calc import calculate_budget


def lock_budget(year: int, locked_by: str) -> dict:
    """Append a whole-year snapshot, calculated on the server from Initial and saved budget inputs."""
    if not 2000 <= year <= 2100:
        raise ValueError("year must be between 2000 and 2100")
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
        blocks = [building_blocks._block_view(dict(row)) for row in conn.execute(
            text(building_blocks._BLOCK_SELECT + " WHERE block.plan = 'budget'")
        ).mappings().all()]
        promos = [promotions._promotion_view(dict(row)) for row in conn.execute(
            text(promotions._PROMOTION_SELECT + " WHERE promotion.plan = 'budget'")
        ).mappings().all()]
        frozen = calculate_budget(rows, blocks, promos, year, breakdown["rows"])
        snapshot = dict(conn.execute(text("""
            INSERT INTO budget_snapshots (year, version, locked_by, inputs)
            SELECT :year, COALESCE(MAX(version), 0) + 1, :locked_by, CAST(:inputs AS JSONB)
            FROM budget_snapshots WHERE year = :year
            RETURNING snapshot_id, year, version, locked_at, locked_by
        """), {"year": year, "locked_by": locked_by, "inputs": json.dumps({"blocks": blocks, "promotions": promos,
            "initial_breakdown": breakdown,
            "initial_stamps": sorted({row["initial_generated_at"] for row in rows if row.get("initial_generated_at")})})}).mappings().first())
        conn.execute(text("""
            INSERT INTO budget_snapshot_rows
                (snapshot_id, customer_id, customer_name, sku, product_name, sku_range, month_year, units)
            VALUES (:snapshot_id, :customer_id, :customer_name, :sku, :product_name, :sku_range, :month_year, :units)
        """), [{"snapshot_id": snapshot["snapshot_id"], **{key: row.get(key) for key in
            ("customer_id", "customer_name", "sku", "product_name", "sku_range", "month_year", "units")}} for row in frozen])
    return {**snapshot, "locked_at": common.iso(snapshot["locked_at"]), "row_count": len(frozen)}


def read_budgets(year: int | None = None, version: int | None = None) -> dict:
    """History plus rows of each year's latest lock, or one historical version."""
    if version is not None and year is None:
        raise ValueError("Choose a year when requesting a version.")
    with common.read_connection() as conn:
        if not common.has_budget_tables(conn):
            if year is not None:
                raise common.BudgetSetupRequiredError(common.BUDGET_SETUP_DETAIL)
            return {"history": [], "rows": [], "setup_required": True, "message": common.BUDGET_SETUP_DETAIL}
        history = [dict(row) for row in conn.execute(text("""
            SELECT snapshot_id, year, version, locked_at, locked_by FROM budget_snapshots
            WHERE (CAST(:year AS INTEGER) IS NULL OR year = :year) ORDER BY year DESC, version DESC
        """), {"year": year}).mappings().all()]
        chosen = {}
        for item in history:
            if item["year"] not in chosen and (version is None or item["version"] == version):
                chosen[item["year"]] = item["snapshot_id"]
        rows = conn.execute(text("""
            SELECT r.*, COALESCE(c.customer_name, r.customer_name) AS current_customer_name,
                COALESCE(p.product_name, r.product_name) AS current_product_name,
                CASE WHEN p.sku IS NULL THEN r.sku_range ELSE p.sku_range END AS current_sku_range
            FROM budget_snapshot_rows r LEFT JOIN customers c ON c.customer_id = r.customer_id
            LEFT JOIN skus p ON p.sku = r.sku
            WHERE snapshot_id = ANY(:ids) ORDER BY r.month_year, r.customer_id, r.sku
        """), {"ids": list(chosen.values())}).mappings().all() if chosen else []
    return {"history": [{**item, "locked_at": common.iso(item["locked_at"])} for item in history],
            "rows": [{**dict(row), "customer_name": row["current_customer_name"], "product_name": row["current_product_name"],
                      "sku_range": row["current_sku_range"], "month_year": row["month_year"].isoformat(), "units": float(row["units"])} for row in rows]}


def sellout_for_customer(conn: Connection, customer_id: int) -> dict[str, dict[date, float]]:
    """Latest locked sell-out per year for Inventory, keyed by stable SKU code."""
    if not common.has_budget_tables(conn):
        return {}
    rows = conn.execute(text("""
        SELECT r.sku, r.month_year, r.units FROM budget_snapshot_rows r
        JOIN (SELECT DISTINCT ON (year) snapshot_id FROM budget_snapshots ORDER BY year, version DESC) latest
        USING (snapshot_id) WHERE r.customer_id = :customer_id
    """), {"customer_id": customer_id}).mappings().all()
    result = {}
    for row in rows:
        result.setdefault(row["sku"], {})[row["month_year"]] = float(row["units"])
    return result
