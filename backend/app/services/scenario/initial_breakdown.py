"""Reconstruct Initial's Tier 0 parts at its own training cut-off, without rewriting a forecast."""

import math
import re
from datetime import date
from decimal import Decimal

from google.cloud.bigquery import ScalarQueryParameter

from app.services import bigquery
from app.services.scenario import tier0_breakdown, tier0_split
from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_moment_rules


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


def _historical_discounts(inputs: dict) -> tuple[dict, dict]:
    # Historical percentage-off text can identify a discount even when that
    # mechanic was never configured. Other mechanics need a saved discount.
    fallbacks = {}

    def discount_in(key: str, month: date):
        saved = inputs["discount_in"](key, month)
        if saved is not None:
            return saved
        match = re.fullmatch(r"pct_off_(\d+(?:\.\d+)?)", key or "")
        discount = Decimal(match[1]) if match else None
        if discount is None or discount > 100:
            return None
        fallbacks[(key, month)] = float(discount)
        return discount

    return {**inputs, "discount_in": discount_in}, fallbacks


def get_initial_breakdown(
    year: int, customer_name: str | None = None, sku_range: str | None = None,
    forecast_rows: list[dict] | None = None,
) -> dict:
    """Initial's anchor baseline and carried effects; flag any cells that cannot be reconciled safely."""
    if not 2000 <= year <= 2100:
        raise ValueError("year must be between 2000 and 2100")
    scope = bigquery.resolve_forecast_scope(customer_name=customer_name, sku_range=sku_range)
    result = {"basis": "initial", "year": year, "data_cutoff": None, "rows": [], "unavailable": []}
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
        missing = sorted({name for source in sources for name in source.get("missing", [])})
        if missing:
            result["unavailable"].append({"customer_id": key[0], "sku": key[1], "month_year": row["month_year"],
                                          "reason": "Historical promotions have no usable uplift: " + ", ".join(missing)})
            continue
        valid = split is not None and all(math.isfinite(float(split[key])) for key in ("tier0", "baseline", "carried"))
        if not valid or split["baseline"] < 0 or abs(split["tier0"] - row["forecast_initial"]) > SPLIT_TOLERANCE:
            result["unavailable"].append({"customer_id": key[0], "sku": key[1], "month_year": row["month_year"],
                                          "reason": "Source history at Initial's data cut-off does not match its published units."})
            continue
        for source in sources:
            source["discount_fallbacks"] = {mechanic: discount for (mechanic, month), discount in fallbacks.items()
                                            if month.isoformat() == source["month"]}
        result["rows"].append({"customer_id": key[0], "sku": key[1], "data_cutoff": cutoff.isoformat(),
                               "initial_generated_at": row.get("initial_generated_at"),
                               **_normalise(split, float(row["forecast_initial"]))})
    return result
