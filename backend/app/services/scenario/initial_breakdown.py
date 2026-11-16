"""Reconstruct Initial's Tier 0 parts at its own training cut-off, without rewriting a forecast."""

import math
from datetime import date, datetime

from google.cloud.bigquery import ScalarQueryParameter
from sqlalchemy import text

from app.services import bigquery
from app.services.scenario import common, tier0_breakdown, tier0_split
from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_moment_rules
from app.services.settings import promo_uplift_rules as uplift_rules


SPLIT_TOLERANCE = 1.0


def _cutoff(year: int) -> date | None:
    rows = list(bigquery.run_query(
        f"""
        SELECT data_cutoff
        FROM `{bigquery._forecast_dataset()}.aire_forecasting_initial_meta`
        WHERE forecast_year = @year
        """,
        [ScalarQueryParameter("year", "INT64", year)],
    ))
    return rows[0]["data_cutoff"] if rows else None


def _normalise(split: dict, initial: float) -> dict:
    # Tier 0 is published in rounded cartons. Keep its exact published total
    # while preserving the reconstructed baseline/carried proportions.
    raw = split["tier0"]
    baseline = split["baseline"] * initial / raw if raw else initial
    return {**split, "reconstructed_tier0": raw, "tier0": initial, "baseline": baseline,
            "carried": initial - baseline, "basis": "initial",
            "official": {"uplift_pct": 0, "promotions": [], "level": None, "missing": [], "planned": False}}


def _unsplit(row: dict, cutoff: date) -> dict:
    # Sales before the cut-off were revised after Initial was fixed, so its
    # parts can't be rebuilt: the whole Initial counts as baseline and
    # nothing is carried, so a budget promotion there adds on top.
    initial = float(row["forecast_initial"])
    return {"customer_id": row["customer_id"], "sku": row["sku"], "month_year": row["month_year"],
            "data_cutoff": cutoff.isoformat(), "initial_generated_at": row.get("initial_generated_at"),
            "tier0": initial, "baseline": initial, "carried": 0.0, "run_rate": None, "base_method": "unsplit",
            "last_year": None, "recent": [], "carried_level": None, "unsplit": True, "basis": "initial",
            "official": {"uplift_pct": 0, "promotions": [], "level": None, "missing": [], "planned": False}}


def _historical_discounts(inputs: dict) -> tuple[dict, dict]:
    # A historical mechanic's text states its discount ("45% Off", "Buy 10 Get
    # 10 Free") even when it was never configured; a saved discount wins.
    fallbacks = {}

    saved_in = inputs.get("saved_discount_in", inputs["discount_in"])

    def discount_in(key: str, month: date):
        saved = saved_in(key, month)
        if saved is not None:
            return saved
        discount = uplift_rules.derived_discount(key)
        if discount is None:
            return None
        fallbacks[(key, month)] = float(discount)
        return discount

    return {**inputs, "discount_in": discount_in}, fallbacks


def _revised_customers(rows: list[dict], cutoff: date) -> set[int]:
    # Customers whose sell-out up to the cut-off was written or rolled back
    # after the Initial being shown was made (sellout_versions, ingestion_runs):
    # the evidence a cell that no longer matches was revised, not mis-rebuilt.
    stamps = [row["initial_generated_at"] for row in rows if row.get("initial_generated_at")]
    if not stamps:
        return set()
    since = min(datetime.fromisoformat(str(stamp).replace("Z", "+00:00")) for stamp in stamps)
    after_cutoff = date(cutoff.year + cutoff.month // 12, cutoff.month % 12 + 1, 1)
    with common.read_connection() as conn:
        return {int(row[0]) for row in conn.execute(text("""
            SELECT DISTINCT cr.customer_id
            FROM sellout_versions v
            JOIN customer_retailers cr ON cr.retailer_id = v.retailer_id
            LEFT JOIN ingestion_runs r ON r.ingestion_id = v.ingestion_id
            WHERE v.period_start < :after_cutoff
              AND (v.recorded_at > :since OR r.rolled_back_at > :since)
        """), {"after_cutoff": after_cutoff, "since": since}).all()}


def get_initial_breakdown(
    year: int, customer_name: str | None = None, sku_range: str | None = None,
    forecast_rows: list[dict] | None = None,
) -> dict:
    """
    Initial's anchor baseline and carried effects. Cells that no longer match
    Initial come back whole (`unsplit`, listed under that key) only when their
    customer's sales up to the cut-off changed after Initial was made
    (_revised_customers); any other mismatch, and cells that cannot be read
    safely at all, are `unavailable`.
    """
    if not 2000 <= year <= 2100:
        raise ValueError("year must be between 2000 and 2100")
    scope = bigquery.resolve_forecast_scope(customer_name=customer_name, sku_range=sku_range)
    result = {"basis": "initial", "year": year, "data_cutoff": None, "rows": [], "unavailable": [], "unsplit": []}
    if bigquery._scope_is_empty(scope):
        return result
    output = forecast_rows if forecast_rows is not None else bigquery.get_forecast_output_rows(
        customer_name=customer_name, sku_range=sku_range, start_date=f"{year}-01-01", end_date=f"{year}-12-01",
        tier=bigquery.DEFAULT_FORECAST_TIER,
    )
    initial = [row for row in output if row.get("forecast_initial") is not None and row["month_year"].startswith(f"{year}-")]
    if not initial:
        return result
    cutoff = _cutoff(year)
    if cutoff is None:
        result["unavailable"] = [{"reason": "Initial has no recorded data cut-off; its source months cannot be identified."}]
        return result
    result["data_cutoff"] = cutoff.isoformat()
    history = {key: {month: units for month, units in series.items() if month <= cutoff}
               for key, series in tier0_breakdown._history(scope).items()}
    inputs = tier0_breakdown._settings_inputs(scope["customer_ids"])
    # Rebuild moments from the cut-off history. Today's cached moments can
    # contain later sales in their baselines even when their own month is old.
    moments = promo_moment_rules.find_moments(inputs["promotions"], history)
    measured = versions.measure_by_version(moments, inputs["sku_ranges"], inputs["anchor_for"])
    by_series = {}
    for moment in measured:
        by_series.setdefault((moment["customer_id"], moment["sku"]), []).append(moment)
    promotions = {}
    for item in inputs["promotions"]:
        promotions.setdefault((item["customer_id"], item["sku"]), []).append(item)
    # Read only when a cell doesn't match, so a clean year never queries the audit tables.
    revised = None
    for row in initial:
        key = (row["customer_id"], row["sku"])
        series = history.get(key, {})
        target = date.fromisoformat(row["month_year"])
        historical_inputs, fallbacks = _historical_discounts(inputs)
        carried_for = tier0_breakdown._carried_for(historical_inputs, promotions.get(key, []), by_series.get(key, []), *key, trace=True)
        try:
            split = tier0_split.month_split(series, max(series), target, carried_for) if series else None
        except ArithmeticError:
            split = None
        sources = ([split["last_year"]] if split and split["last_year"] else []) + (split["recent"] if split else [])
        cell = {"customer_id": key[0], "sku": key[1], "month_year": row["month_year"]}
        # Tier 0 first: a revised cell is kept whole whatever else is wrong with its rebuilt parts.
        if split is not None and math.isfinite(float(split["tier0"])) and abs(split["tier0"] - row["forecast_initial"]) > SPLIT_TOLERANCE:
            if revised is None:
                revised = _revised_customers(initial, cutoff)
            if key[0] in revised:
                result["unsplit"].append({**cell, "customer_name": row.get("customer_name"),
                                          "reason": "Sales up to Initial's data cut-off changed after Initial was fixed."})
                result["rows"].append(_unsplit(row, cutoff))
            else:
                # No sales changed, so the rebuild itself is wrong: never lock on a guess.
                result["unavailable"].append({**cell, "reason": "Initial's rebuilt units do not match its published units, "
                                              "and no sales changed since it was made; check the Initial build."})
            continue
        missing = sorted({name for source in sources for name in source.get("missing", [])})
        if missing:
            result["unavailable"].append({**cell, "reason": "Historical promotions have no usable uplift: " + ", ".join(missing)})
            continue
        valid = split is not None and all(math.isfinite(float(split[key])) for key in ("tier0", "baseline", "carried"))
        if not valid or split["baseline"] < 0:
            result["unavailable"].append({**cell, "reason": "Source history at Initial's data cut-off does not give usable units."})
            continue
        for source in sources:
            source["discount_fallbacks"] = {mechanic: discount for (mechanic, month), discount in fallbacks.items()
                                            if month.isoformat() == source["month"]}
        result["rows"].append({"customer_id": key[0], "sku": key[1], "data_cutoff": cutoff.isoformat(),
                               "initial_generated_at": row.get("initial_generated_at"),
                               **_normalise(split, float(row["forecast_initial"]))})
    return result
