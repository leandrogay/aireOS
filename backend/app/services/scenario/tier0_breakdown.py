from datetime import date

from app.services import bigquery
from app.services.scenario import common
from app.services.scenario import tier0_split
from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_moments, promo_uplifts


# The Scenario builder's split of Tier 0 into the ordinary-month baseline
# and the promotions it carries (pure rules in tier0_split.py), per customer
# x SKU x forecast month (GET /api/scenario/tier0-breakdown). Read-only.
#
# Tier 0's own months come from the forecast's training input in BigQuery
# (fc_training_input, the table the Tier 0 view reads), so the parts add up
# to the Tier 0 the page shows; each row carries `tier0` so the page can
# check that before it uses the split. The promotions, moments, anchors and
# discounts come from Cloud SQL: uplifts are the averaged values Promotion
# uplift settings shows (choose_uplift over promo_moment_calc), for the
# anchor version and the mechanic discount in effect in each month, so a
# setting changed today never moves a past month.


# ============================================================
# READS
# ============================================================


def _history(scope: dict) -> dict[tuple[int, str], dict[date, float]]:
    where_clauses, query_parameters = bigquery._scope_filters(scope, "")
    where = "".join(f"\n  AND {clause}" for clause in where_clauses)
    rows = bigquery.run_query(
        f"""
        SELECT customer_id, sku, month_year, quantity_cartons
        FROM `{bigquery._forecast_dataset()}.fc_training_input`
        WHERE TRUE{where}
        """,
        query_parameters,
    )
    history: dict[tuple[int, str], dict[date, float]] = {}
    for row in rows:
        history.setdefault((row["customer_id"], row["sku"]), {})[row["month_year"]] = float(row["quantity_cartons"])
    return history


def _settings_inputs(customer_ids: list[int] | None) -> dict:
    # One customer is filtered in SQL; several (All customers) are picked out here.
    one = customer_ids[0] if customer_ids is not None and len(customer_ids) == 1 else None
    wanted = set(customer_ids) if customer_ids is not None else None
    with common.read_connection() as conn:
        promotions = promo_moments._offline_promotions(conn, one)
        moments = promo_moments._calculated_moments(conn)
        return {
            "promotions": [p for p in promotions if wanted is None or p["customer_id"] in wanted],
            "moments": [m for m in moments if wanted is None or m["customer_id"] in wanted],
            "sku_ranges": promo_moments.sku_ranges(conn),
            "anchor_for": versions.version_lookup(promo_uplifts._anchor_rows(conn)),
            "discount_in": promo_uplifts.mechanic_discount_lookup(conn),
        }


# ============================================================
# UPLIFTS
# ============================================================


def _measured(moment: dict) -> dict:
    # promo_moment_calc's columns under the names choose_uplift reads.
    return {**moment, "version_id": moment["anchor_id"]}


def _carried_for(inputs: dict, promotions: list[dict], measured: list[dict], customer_id: int, sku: str, trace: bool = False):
    sku_range = inputs["sku_ranges"].get(sku)

    def uplift_for(mechanic_key: str, month: date) -> dict:
        version = inputs["anchor_for"](customer_id, sku_range, month)
        return versions.choose_uplift(
            measured, mechanic_key, version, lambda key: inputs["discount_in"](key, month)
        )

    def carried_for(month: date) -> dict:
        result = tier0_split.month_uplift(promotions, month, uplift_for)
        if trace:
            result["anchor"] = inputs["anchor_for"](customer_id, sku_range, month)
        return result

    return carried_for


# ============================================================
# THE BREAKDOWN
# ============================================================


def get_tier0_breakdown(
    customer_name: str | None = None, sku_range: str | None = None,
    basis: str = "current", year: int | None = None,
) -> dict:
    """
    Every forecast month of the customers and SKU range asked for, split into
    Tier 0's baseline at the anchor and the promotions it carries, with the
    official promotions planned for that month (tier0_split.month_split).
    Tier 0 itself is never changed: the Scenario builder works out what
    replacing the carried promotions does.
    """

    if basis not in ("current", "initial"):
        raise ValueError("basis must be current or initial")
    if basis == "initial":
        if year is None:
            raise ValueError("Choose a year for the Initial forecast breakdown.")
        from app.services.scenario.initial_breakdown import get_initial_breakdown

        return get_initial_breakdown(year, customer_name, sku_range)
    scope = bigquery.resolve_forecast_scope(customer_name=customer_name, sku_range=sku_range)
    if bigquery._scope_is_empty(scope):
        return {"rows": []}

    history = _history(scope)
    if not history:
        return {"rows": []}
    inputs = _settings_inputs(scope["customer_ids"])

    promotions: dict[tuple[int, str], list[dict]] = {}
    for promotion in inputs["promotions"]:
        promotions.setdefault((promotion["customer_id"], promotion["sku"]), []).append(promotion)
    measured: dict[tuple[int, str], list[dict]] = {}
    for moment in inputs["moments"]:
        measured.setdefault((moment["customer_id"], moment["sku"]), []).append(_measured(moment))

    rows = []
    for (customer_id, sku), series in sorted(history.items()):
        latest = max(series)
        carried_for = _carried_for(
            inputs, promotions.get((customer_id, sku), []), measured.get((customer_id, sku), []), customer_id, sku
        )
        for ahead in range(1, tier0_split.HORIZON_MONTHS + 1):
            row = tier0_split.month_split(series, latest, tier0_split.add_months(latest, ahead), carried_for)
            if row is not None:
                rows.append({"customer_id": customer_id, "sku": sku, **row})
    return {"rows": rows}
