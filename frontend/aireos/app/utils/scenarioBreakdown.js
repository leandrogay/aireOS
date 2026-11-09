// ============================================================
// SCENARIO BREAKDOWN -- pure, import-free (tests/scenarioBreakdown.test.mjs)
// ============================================================
//
// What the Breakdown tab explains for one month: how Tier 0 was built (same
// month last year and the recent run-rate, with the discounts that ran in
// those months), then what the scenario adds on top (growth, building
// blocks, promotions). Totals are over every forecast row in view, so with
// All SKUs picked they are the customer's totals, never one SKU's.
//
// The Tier 0 parts (tier0_ly_cartons, tier0_run_rate, tier0_base_method,
// tier0_recent_months) come from the forecast run once it saves them
// (bigquery/schemas/tier0_component_contract.md); until then `available` is
// false and only the Tier 0 total is known.

const LY_WEIGHT = 0.5; // pl_forecast.ForecastParams.ly_weight

function numberOrNull(value) {
  return value == null || value === '' ? null : Number(value);
}

/**
 * The months with a Tier 0 forecast, in order: the months the tab can show.
 *
 * @param {object[]} rows forecast rows
 */
export function breakdownMonths(rows) {
  return [...new Set(rows.filter((row) => row.forecast_current != null).map((row) => row.month_year))].sort();
}

/**
 * 'YYYY-MM-01' a year earlier.
 *
 * @param {string} month
 */
export function sameMonthLastYear(month) {
  return `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
}

/**
 * How Tier 0 was built for one month, totalled over the rows in view.
 *
 * `lastYear` and `runRate` are the totals of the rows that have them;
 * `blendedRows` used half of each, `runRateOnlyRows` had no sales in that
 * month last year and are the run-rate alone. `recentMonths` is the
 * run-rate window, every series' months together.
 *
 * @param {object[]} rows forecast rows
 * @param {string} month 'YYYY-MM-01'
 */
export function tier0Breakdown(rows, month) {
  const monthRows = rows.filter((row) => row.month_year === month && row.forecast_current != null);
  const available = monthRows.some((row) => row.tier0_run_rate != null);
  let lastYear = 0;
  let runRate = 0;
  let blendedRows = 0;
  let runRateOnlyRows = 0;
  const recentMonths = new Set();

  for (const row of monthRows) {
    const ly = numberOrNull(row.tier0_ly_cartons);
    const rate = numberOrNull(row.tier0_run_rate);
    if (rate != null) runRate += rate;
    if (ly != null) {
      lastYear += ly;
      blendedRows += 1;
    } else if (rate != null) {
      runRateOnlyRows += 1;
    }
    for (const recent of row.tier0_recent_months ?? []) recentMonths.add(recent);
  }

  return {
    month,
    lastYearMonth: sameMonthLastYear(month),
    tier0: monthRows.reduce((sum, row) => sum + Number(row.forecast_current), 0),
    available,
    lastYear: available && blendedRows ? lastYear : null,
    runRate: available ? runRate : null,
    lyWeight: LY_WEIGHT,
    blendedRows,
    runRateOnlyRows,
    rowCount: monthRows.length,
    recentMonths: [...recentMonths].sort(),
  };
}

/**
 * What the scenario adds in one month, by source: growth, building blocks,
 * promotions, and the total.
 *
 * @param {Array<{ source: string, deltaUnits: number }>} items the month's entries of the page's monthItems
 */
export function scenarioAdjustments(items = []) {
  const totals = { growth: 0, blocks: 0, promotions: 0, total: 0 };
  for (const item of items) {
    if (item.source in totals) totals[item.source] += item.deltaUnits;
    totals.total += item.deltaUnits;
  }
  return totals;
}

export function discountSourceLabel(source) {
  return {
    measured: 'Measured',
    anchor: 'Anchor fallback',
    not_frozen_yet: 'Not frozen yet',
  }[source] ?? source ?? '';
}
