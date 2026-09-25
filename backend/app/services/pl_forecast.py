"""
P&L-style sell-out forecast -- pure functions, no I/O.

Mirrors the sell-out half of Aire's P&L workbook ("Forecast with Build" and
"Building Blocks" sheets) so the Forecast page shows numbers the business
already recognises:

    predicted units = Sell-out Base + Sell-out Building Blocks
    Sell-out Base   = ly_weight       x (same month last year x YoY growth)   P&L: =L104*1.05
                    + (1 - ly_weight) x (3-month run-rate)                  P&L: =X58
    Building Blocks = Base x uplift for that month's promo_type             P&L: 'Building Blocks'!

Inventory (opening stock, sell-in, DOH) is read-only reference data in
BigQuery's inventory_metrics table, not owned by this module -- see
inventory_forecast.py for the rolling actual/predicted closing-inventory and
recommended-sell-in model built on top of this one's sell-out forecast.
Postgres owns only the sku/customer identity mapping used to bridge that
table's sku/customer_id columns to this module's product_name/customer_name.
forecast_service.py does the BigQuery reads and writes around these functions,
so everything here can be tested with a few inline DataFrame rows.
"""

import datetime
from dataclasses import dataclass

import pandas as pd

GROUP_KEY = ["product_name", "customer_name"]
PROMO_COLUMNS = ["promo_type", "promotion_mechanic", "period_label", "voucher"]
HORIZON_MONTHS = 12


# ============================================================
# PARAMETERS
# ============================================================


@dataclass(frozen=True)
class ForecastParams:
    """Tuning knobs, defaulted to what reproduces the P&L's behaviour."""

    ly_weight: float = 0.5          # share of Base that comes from last year x growth
    growth_floor: float = 0.85      # YoY growth is clipped so one odd quarter can't swing a year
    growth_cap: float = 1.25
    runrate_months: int = 3         # same 3-month window the P&L's DOH formula averages over
    uplift_cap: float = 1.0         # no promo is allowed to more than double sell-out
    min_uplift_obs: int = 3         # fewer promo months than this => too noisy, uplift 0
    partial_ratio: float = 0.6      # latest month under 60% of trailing avg => treated as partial

    def __post_init__(self) -> None:
        if not 0 <= self.ly_weight <= 1:
            raise ValueError("ly_weight must be between 0 and 1")
        if not 0 < self.growth_floor <= self.growth_cap:
            raise ValueError("growth_floor must be > 0 and <= growth_cap")
        if self.runrate_months < 1 or self.min_uplift_obs < 1:
            raise ValueError("runrate_months and min_uplift_obs must be at least 1")


def validate_uplift_override(uplift_override: dict[str, float]) -> None:
    """Hand-typed uplifts play the role of the P&L's Building Blocks rows, so they must be sane."""
    for promo_type, uplift in uplift_override.items():
        if not promo_type:
            raise ValueError("uplift override needs a promo_type")
        if uplift < 0:
            raise ValueError(f"uplift for {promo_type} must be >= 0")


# ============================================================
# TABLE ROWS
#
# One forecast-table row is product x customer x month x
# forecast_generated_at; actual rows have forecast_generated_at
# NULL. Rows are normalised once so every later function can
# compare months as pd.Period and promos as str | None.
# ============================================================


def clean_promo(value) -> str | None:
    # pandas turns a missing promo into NaN, which is truthy -- so every
    # "is there a promo this month?" check has to go through here.
    return value if isinstance(value, str) and value.strip() else None


def normalise_rows(rows: pd.DataFrame) -> pd.DataFrame:
    """Forecast-table rows with month_year as a monthly Period and clean promo fields."""
    rows = rows.copy()
    rows["month_year"] = pd.to_datetime(rows["month_year"]).dt.to_period("M")
    run_dates = pd.to_datetime(rows["forecast_generated_at"]).dt.date
    rows["forecast_generated_at"] = run_dates.astype(object).where(run_dates.notna(), None)
    if "run_type" not in rows:
        rows["run_type"] = None
    # Old rows (and actual rows, which don't use this field at all) predate
    # run_type -- default them to 'rolling' so every later function can just
    # compare rows["run_type"] == "yearly" without guarding for a missing
    # or null value.
    rows["run_type"] = rows["run_type"].where(rows["run_type"].notna(), "rolling")
    if "tier" not in rows:
        rows["tier"] = None
    # Old rows (and actual rows, which don't use this field either) predate
    # tier -- default them to 0, this app's own model, so every later
    # function can just compare rows["tier"] == 0 without guarding for a
    # missing or null value.
    rows["tier"] = pd.to_numeric(rows["tier"], errors="coerce").fillna(0).astype(int)
    for column in PROMO_COLUMNS:
        if column not in rows:
            rows[column] = None
        rows[column] = rows[column].map(clean_promo)
    return rows


def _actual_rows(rows: pd.DataFrame) -> pd.DataFrame:
    return rows[rows["forecast_generated_at"].isna()]


def _forecast_rows(rows: pd.DataFrame) -> pd.DataFrame:
    return rows[rows["forecast_generated_at"].notna()]


def _customer_ids(rows: pd.DataFrame) -> dict[str, int]:
    ids = rows.dropna(subset=["customer_id"]).groupby("customer_name")["customer_id"].first()
    return {name: int(customer_id) for name, customer_id in ids.items()}


def _promo_lookup(rows: pd.DataFrame) -> dict[tuple, dict]:
    # The promo calendar lives on the forecast table itself, so a new month
    # inherits whatever promo an existing row already planned for it. Later
    # runs are applied last so the most recent plan wins.
    ordered = rows.assign(_run=rows["forecast_generated_at"].map(lambda d: d or datetime.date.min))
    lookup = {}
    for row in ordered.sort_values("_run").itertuples():
        key = (row.product_name, row.customer_name, row.month_year)
        lookup[key] = {column: getattr(row, column) for column in PROMO_COLUMNS}
    return lookup


def _no_promo() -> dict:
    return {column: None for column in PROMO_COLUMNS}


# ============================================================
# ACTUALS FROM SELL-OUT WEEKS
# ============================================================


def complete_months(weeks: pd.DataFrame) -> pd.DataFrame:
    """Weekly sell-out -> monthly actuals, keeping only months the data fully covers.

    A week counts toward the month it starts in (same rule the FairPrice
    ingest used). A month is complete when the customer's data starts no
    later than its first week and reaches the week holding its last day, so
    a half-loaded month never shows up on the Actual line.
    """
    weeks = weeks.copy()
    weeks["period_start"] = pd.to_datetime(weeks["period_start"])
    weeks["month_year"] = weeks["period_start"].dt.to_period("M")

    monthly_parts = []
    for customer_name, customer_weeks in weeks.groupby("customer_name"):
        first_week = customer_weeks["period_start"].min()
        last_week = customer_weeks["period_start"].max()
        monthly = customer_weeks.groupby(["product_name", "month_year"], as_index=False)[
            ["quantity_units", "revenue"]
        ].sum()
        month_start = monthly["month_year"].dt.start_time
        month_end = monthly["month_year"].dt.end_time.dt.normalize()
        one_week = pd.Timedelta(days=6)
        covered = (first_week <= month_start + one_week) & (last_week >= month_end - one_week)
        monthly = monthly[covered].assign(customer_name=customer_name)
        monthly_parts.append(monthly)

    if not monthly_parts:
        return pd.DataFrame(columns=["product_name", "customer_name", "month_year", "quantity_units", "revenue"])
    result = pd.concat(monthly_parts, ignore_index=True)
    result["revenue"] = result["revenue"].round(2)
    return result[["product_name", "customer_name", "month_year", "quantity_units", "revenue"]]


def diff_actuals(rows: pd.DataFrame, monthly: pd.DataFrame) -> pd.DataFrame:
    """Actual rows that need writing: months whose numbers changed, plus months not in the table yet.

    Only returning real changes keeps a re-run with no new data a no-op.
    """
    ids = _customer_ids(rows)
    promos = _promo_lookup(rows)
    current = _actual_rows(rows).set_index(GROUP_KEY + ["month_year"])[["quantity_units", "revenue"]]
    next_customer_id = max(ids.values(), default=0) + 1

    changes = []
    for source in monthly.itertuples():
        key = (source.product_name, source.customer_name, source.month_year)
        if source.customer_name not in ids:
            ids[source.customer_name] = next_customer_id
            next_customer_id += 1
        change = {
            "product_name": source.product_name,
            "customer_name": source.customer_name,
            "month_year": source.month_year,
            "customer_id": ids[source.customer_name],
            "quantity_units": float(source.quantity_units),
            "revenue": float(source.revenue),
        }
        if key not in current.index:
            changes.append({**change, **promos.get(key, _no_promo()), "change": "new month"})
            continue
        old = current.loc[key]
        units_changed = pd.isna(old["quantity_units"]) or abs(old["quantity_units"] - change["quantity_units"]) > 1e-6
        revenue_changed = pd.isna(old["revenue"]) or abs(old["revenue"] - change["revenue"]) > 0.005
        if units_changed or revenue_changed:
            changes.append({**change, **promos.get(key, _no_promo()),
                            "change": f"{old['quantity_units']:g} -> {change['quantity_units']:g}"})

    columns = GROUP_KEY + ["month_year", "customer_id", "quantity_units", "revenue", *PROMO_COLUMNS, "change"]
    return pd.DataFrame(changes, columns=columns)


def apply_actual_changes(rows: pd.DataFrame, changes: pd.DataFrame) -> pd.DataFrame:
    """In-memory equivalent of the actuals MERGE, so a preview forecasts from the refreshed numbers."""
    if changes.empty:
        return rows
    key = GROUP_KEY + ["month_year"]
    actuals = _actual_rows(rows).set_index(key)
    updates = changes.set_index(key)

    existing = updates.index.intersection(actuals.index)
    actuals.loc[existing, ["quantity_units", "revenue"]] = updates.loc[existing, ["quantity_units", "revenue"]]

    new_months = updates.drop(index=existing).drop(columns=["change"]).assign(
        forecast_generated_at=None, predicted_quantity_units=None, predicted_revenue=None
    )
    return pd.concat(
        [actuals.reset_index(), new_months.reset_index(), _forecast_rows(rows)], ignore_index=True
    )


def usable_actuals(rows: pd.DataFrame, params: ForecastParams,
                   exclude_months: set[str]) -> tuple[pd.DataFrame, list[str]]:
    """Actual rows the model may learn from, plus a note of any month it ignored and why.

    The partial-month check is a safety net for when the table was filled
    without complete_months() (e.g. the original mock had Aug 2026 = 2 weeks).
    """
    actuals = _actual_rows(rows).dropna(subset=["quantity_units"])
    ignored = sorted(exclude_months)
    actuals = actuals[~actuals["month_year"].astype(str).isin(exclude_months)]

    totals = actuals.groupby("month_year")["quantity_units"].sum().sort_index()
    if len(totals) >= 4:
        latest, trailing = totals.index[-1], totals.iloc[-4:-1].mean()
        if totals.iloc[-1] < params.partial_ratio * trailing:
            actuals = actuals[actuals["month_year"] != latest]
            ignored.append(f"{latest} (looks partial: {totals.iloc[-1]:.0f} vs trailing avg {trailing:.0f})")
    return actuals, ignored


# ============================================================
# MODEL
# ============================================================


def estimate_uplifts(actuals: pd.DataFrame, params: ForecastParams) -> dict[str, float]:
    """Uplift per promo_type = median(promo month / avg of neighbouring no-promo months) - 1.

    This is the data-driven stand-in for the hand-typed Building Blocks rows;
    comparing against the months either side cancels out the SKU's trend.
    """
    ratios: dict[str, list[float]] = {}
    for _, sku_rows in actuals.groupby(GROUP_KEY):
        history = sku_rows.set_index("month_year").sort_index()
        for month, row in history.iterrows():
            promo = clean_promo(row["promo_type"])
            if not promo:
                continue
            neighbours = [
                history.loc[other, "quantity_units"]
                for other in (month - 1, month + 1)
                if other in history.index and not clean_promo(history.loc[other, "promo_type"])
            ]
            if neighbours and sum(neighbours) > 0:
                ratios.setdefault(promo, []).append(row["quantity_units"] / (sum(neighbours) / len(neighbours)))

    uplifts = {}
    for promo, promo_ratios in ratios.items():
        if len(promo_ratios) < params.min_uplift_obs:
            uplifts[promo] = 0.0
        else:
            uplift = pd.Series(promo_ratios).median() - 1
            uplifts[promo] = float(min(max(uplift, 0.0), params.uplift_cap))
    return uplifts


def _base_history(history: pd.DataFrame, uplifts: dict[str, float]) -> pd.Series:
    # Take past promo uplift out of the actuals, otherwise a promo month
    # inflates the base and then gets its uplift added a second time.
    uplift_factor = history["promo_type"].map(lambda promo: 1 + uplifts.get(clean_promo(promo), 0.0))
    return history["quantity_units"] / uplift_factor


def _growth_factor(base: pd.Series, window: list[pd.Period], params: ForecastParams) -> float | None:
    recent = base.reindex(window)
    last_year = base.reindex([month - 12 for month in window])
    if recent.isna().any() or last_year.isna().any() or last_year.sum() <= 0:
        return None
    return min(max(recent.sum() / last_year.sum(), params.growth_floor), params.growth_cap)


def forecast_sku(history: pd.DataFrame, promo_by_month: dict, months: list[pd.Period],
                 uplifts: dict[str, float], params: ForecastParams) -> pd.DataFrame:
    """Monthly Base, Building Blocks and total for one SKU x customer.

    `history` is that SKU's usable actual rows indexed by month. SKUs with
    under a year of history (Ultra Pants / Tape) fall back to run-rate only.
    """
    base = _base_history(history, uplifts)
    latest = base.index.max()
    window = [latest - offset for offset in range(params.runrate_months)]
    run_rate = base.reindex(window).dropna().mean()
    growth = _growth_factor(base, window, params)

    forecast = []
    for month in months:
        last_year = base.get(month - 12)
        if growth is not None and last_year is not None and not pd.isna(last_year):
            month_base = params.ly_weight * last_year * growth + (1 - params.ly_weight) * run_rate
            method = "ly_x_growth+runrate"
        else:
            month_base = run_rate
            method = "runrate"
        promo = clean_promo(promo_by_month.get(month))
        building_blocks = month_base * uplifts.get(promo, 0.0) if promo else 0.0
        forecast.append({
            "month_year": month,
            "sell_out_base": month_base,
            "sell_out_building_blocks": building_blocks,
            "total_sell_out": month_base + building_blocks,
            "base_method": method,
        })
    return pd.DataFrame(forecast)


# ============================================================
# FORECAST RUNS
#
# A "rolling" run is every row sharing one forecast_generated_at,
# generated fresh each time a newer complete actual month exists.
# The page draws the first rolling run as Initial, the second-latest
# as Previous and the latest as Current, so older runs must stay
# frozen. A "yearly" run is a different, independent thing: one
# frozen Jan-Dec baseline per calendar year (see next_yearly_run).
# run_type keeps the two apart, since they can share a
# forecast_generated_at date and target months (see
# app/data/forecasting_output_schema.sql for why).
# ============================================================


def next_run(rows: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Rows for a new 12-month rolling run if a complete actual month is newer than the latest one, else empty.

    The run is dated the last day of that month (the convention the mock
    already uses) and copies promo fields already planned for those months.
    """
    if actuals.empty:
        return pd.DataFrame()
    latest_actual = actuals["month_year"].max()
    # Only this app's own (tier 0) rows are ever this function's business --
    # a Tier 1 row sharing a rolling run's date must never make it think a
    # run already exists.
    rolling_rows = _forecast_rows(rows)
    rolling_rows = rolling_rows[(rolling_rows["run_type"] == "rolling") & (rolling_rows["tier"] == 0)]
    run_dates = rolling_rows["forecast_generated_at"]
    if len(run_dates) and latest_actual <= pd.Period(max(run_dates), "M"):
        return pd.DataFrame()

    run_date = latest_actual.end_time.date()
    ids = _customer_ids(rows)
    promos = _promo_lookup(rows)
    new_rows = []
    for (product_name, customer_name), _ in actuals.groupby(GROUP_KEY):
        for offset in range(1, HORIZON_MONTHS + 1):
            month = latest_actual + offset
            new_rows.append({
                "month_year": month,
                "forecast_generated_at": run_date,
                "run_type": "rolling",
                "tier": 0,
                "customer_id": ids.get(customer_name),
                "customer_name": customer_name,
                "product_name": product_name,
                "quantity_units": None,
                "revenue": None,
                "predicted_quantity_units": None,
                "predicted_revenue": None,
                **promos.get((product_name, customer_name, month), _no_promo()),
            })
    return pd.DataFrame(new_rows)


def next_yearly_run(rows: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Rows for every calendar year that's eligible but doesn't have a frozen Jan-Dec baseline yet.

    Year Y becomes eligible the first time December of Y-1 is a complete
    actual month (already guaranteed by usable_actuals/complete_months
    upstream). Generates every currently-missing eligible year in one call --
    e.g. against years of pre-existing history this adds all of them at
    once, not one per call -- but each year still gets its own independently
    frozen baseline (see runs_to_compute/yearly_runs_to_compute): this only
    controls how many get *added* here, never how many get recomputed later.
    """
    if actuals.empty:
        return pd.DataFrame()

    # Only this app's own (tier 0) rows count as an existing baseline -- a
    # Tier 1 row must never make this think a year is already covered.
    yearly_rows = _forecast_rows(rows)
    yearly_rows = yearly_rows[(yearly_rows["run_type"] == "yearly") & (yearly_rows["tier"] == 0)]
    existing_years = {month.year for month in yearly_rows["month_year"].dropna().unique()}

    dec_years = {month.year for month in actuals["month_year"].unique() if month.month == 12}
    missing_years = sorted({year + 1 for year in dec_years} - existing_years)
    if not missing_years:
        return pd.DataFrame()

    ids = _customer_ids(rows)
    promos = _promo_lookup(rows)
    new_rows = []
    for candidate_year in missing_years:
        run_date = pd.Period(f"{candidate_year - 1}-12", "M").end_time.date()
        months = list(pd.period_range(f"{candidate_year}-01", f"{candidate_year}-12", freq="M"))
        for (product_name, customer_name), _ in actuals.groupby(GROUP_KEY):
            for month in months:
                new_rows.append({
                    "month_year": month,
                    "forecast_generated_at": run_date,
                    "run_type": "yearly",
                    "tier": 0,
                    "customer_id": ids.get(customer_name),
                    "customer_name": customer_name,
                    "product_name": product_name,
                    "quantity_units": None,
                    "revenue": None,
                    "predicted_quantity_units": None,
                    "predicted_revenue": None,
                    **promos.get((product_name, customer_name, month), _no_promo()),
                })
    return pd.DataFrame(new_rows)


def runs_to_compute(rows: pd.DataFrame, recompute_all: bool) -> list[datetime.date]:
    """Latest rolling run plus any rolling run with blank predictions -- or every rolling run when recompute_all.

    A newly added run has blank predictions, so it is always included.
    Yearly runs are never included here -- see yearly_runs_to_compute --
    so recompute_all can never touch an already-frozen baseline. Scoped to
    tier 0 (this app's own rows) -- a Tier 1 row must never get swept up
    into this app's own recompute.
    """
    forecast_rows = _forecast_rows(rows)
    rolling_rows = forecast_rows[(forecast_rows["run_type"] == "rolling") & (forecast_rows["tier"] == 0)]
    all_runs = sorted(rolling_rows["forecast_generated_at"].unique())
    if recompute_all or not all_runs:
        return all_runs
    blank = rolling_rows.loc[rolling_rows["predicted_quantity_units"].isna(), "forecast_generated_at"]
    return sorted({all_runs[-1], *blank})


def yearly_runs_to_compute(rows: pd.DataFrame) -> list[datetime.date]:
    """Yearly baseline runs that have never been computed yet.

    No recompute_all here by design: once a yearly run has a predicted
    value it must never be recomputed, so this can only ever return runs
    that are still entirely blank (a run that failed to compute on a
    previous refresh, or one just added by next_yearly_run this refresh).
    Scoped to tier 0 -- a Tier 1 row must never be swept up here either.
    """
    forecast_rows = _forecast_rows(rows)
    yearly_rows = forecast_rows[(forecast_rows["run_type"] == "yearly") & (forecast_rows["tier"] == 0)]
    blank = yearly_rows.loc[yearly_rows["predicted_quantity_units"].isna(), "forecast_generated_at"]
    return sorted(blank.unique())


def forecast_runs(rows: pd.DataFrame, actuals: pd.DataFrame, prices: dict[str, float],
                  runs: list[datetime.date], params: ForecastParams,
                  uplift_override: dict[str, float]) -> tuple[pd.DataFrame, list[str]]:
    """Predicted units and revenue for every row of the given runs, plus notes for the log.

    Each run only sees actuals up to its own month, so Initial / Previous /
    Current stay honest back-tests of what was knowable at the time.
    """
    forecast_rows = _forecast_rows(rows)
    results, notes = [], []
    for run_date in runs:
        cutoff = pd.Period(run_date, "M")
        known = actuals[actuals["month_year"] <= cutoff]
        uplifts = {**estimate_uplifts(known, params), **uplift_override}
        notes.append(f"run {run_date}: actuals <= {cutoff}; uplifts "
                     + (", ".join(f"{k} {v:+.0%}" for k, v in sorted(uplifts.items())) or "none"))

        run_rows = forecast_rows[forecast_rows["forecast_generated_at"] == run_date]
        for (product_name, customer_name), target in run_rows.groupby(GROUP_KEY):
            history = known[(known["product_name"] == product_name) & (known["customer_name"] == customer_name)]
            if history.empty:
                notes.append(f"  skipped {product_name} / {customer_name}: no actuals before {cutoff}")
                continue
            history = history.set_index("month_year").sort_index()
            # Forecast from the month after the last actual even when the run
            # starts later, so a gap month still feeds the run-rate chain.
            months = list(pd.period_range(history.index.max() + 1, target["month_year"].max(), freq="M"))
            forecast = forecast_sku(history, dict(zip(target["month_year"], target["promo_type"])),
                                    months, uplifts, params)
            forecast = forecast.merge(
                target[["month_year", "customer_id", "run_type", "tier", *PROMO_COLUMNS]], on="month_year"
            )

            price = prices.get(product_name)
            forecast["predicted_quantity_units"] = forecast["total_sell_out"].round().astype(float)
            forecast["predicted_revenue"] = (
                (forecast["predicted_quantity_units"] * price).round(2) if price is not None else None
            )
            forecast["forecast_generated_at"] = run_date
            forecast["product_name"] = product_name
            forecast["customer_name"] = customer_name
            results.append(forecast)

    if not results:
        return pd.DataFrame(), notes
    return pd.concat(results, ignore_index=True), notes
