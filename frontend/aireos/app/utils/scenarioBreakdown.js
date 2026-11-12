// ============================================================
// SCENARIO BREAKDOWN -- pure, import-free (tests/scenarioBreakdown.test.mjs)
// ============================================================
//
// The Breakdown tab's months and what the scenario changes in one of them.
// How Tier 0 itself splits into its baseline and the promotions it carries
// is scenarioTier0Split.monthSplit (from GET /api/scenario/tier0-breakdown).

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
 * What the scenario changes in one month, by source: official promotions
 * (in place of what Tier 0 carries), growth, building blocks, scenario
 * promotions, and the total.
 *
 * @param {Array<{ source: string, deltaUnits: number }>} items the month's entries of the page's monthItems
 */
export function scenarioAdjustments(items = []) {
  const totals = { official: 0, growth: 0, blocks: 0, promotions: 0, total: 0 };
  for (const item of items) {
    if (item.source in totals) totals[item.source] += item.deltaUnits;
    totals.total += item.deltaUnits;
  }
  return totals;
}
