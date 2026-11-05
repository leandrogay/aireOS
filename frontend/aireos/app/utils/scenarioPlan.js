// ============================================================
// SCENARIO MONTHLY PLAN -- pure, no React
// ============================================================
//
// The Scenario builder's planning view: one row per forecast month, summed
// over whatever the filters select (one SKU, or all SKUs and customers),
// with Last year actual, Model forecast (the Current line), Building blocks
// applied and Adjusted forecast (= the Simulated line), in units (the
// scenario predicts volume only), plus the variance of Adjusted against last
// year. Months with actuals are left out: blocks only apply to forecast months.

const CURRENT_UNITS = 'forecast_current';

/**
 * 'YYYY-MM-01' moved by whole months (negative = back).
 *
 * @param {string} monthYear
 * @param {number} months
 */
export function shiftMonth(monthYear, months) {
  const year = Number(monthYear.slice(0, 4));
  const month = Number(monthYear.slice(5, 7)) - 1 + months;
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Units per month_year; a month with no rows is missing.
function totalsByMonth(rows, unitsKey) {
  const totals = new Map();
  for (const row of rows) {
    if (!row.month_year || row[unitsKey] == null) continue;
    if (!totals.has(row.month_year)) totals.set(row.month_year, { units: 0 });
    totals.get(row.month_year).units += row[unitsKey];
  }
  return totals;
}

function variance(adjusted, lastYear) {
  if (!lastYear) return null;
  const units = adjusted.units - lastYear.units;
  return { units, unitsPct: lastYear.units ? units / lastYear.units : null };
}

/**
 * One plan row per forecast month in the fetched rows.
 *
 *   {
 *     month_year,
 *     lastYear: { units } | null,            // null: no sales that month last year
 *     model: { units },                      // Current forecast
 *     blocks: { units },                     // switched-on items' uplift
 *     adjusted: { units },                   // model + blocks
 *     variance: { units, unitsPct } | null,
 *     items: [{ itemId, name }],             // what adds to this month
 *   }
 *
 * @param {{
 *   rows: object[],               forecast rows from GET /api/forecast
 *   lastYearActuals: object[],    actuals for the months 12 months earlier
 *   byMonth: Map,                 simulate().byMonth
 *   monthItems: Map,              month_year → [{ itemId, name }]
 * }} input
 */
export function buildPlanRows({ rows, lastYearActuals, byMonth, monthItems }) {
  const model = totalsByMonth(rows, CURRENT_UNITS);
  const lastYear = totalsByMonth(lastYearActuals, 'quantity_cartons');

  return [...model.keys()].sort().map((monthYear) => {
    const base = model.get(monthYear);
    const delta = byMonth.get(monthYear);
    const blocks = { units: delta?.deltaUnits ?? 0 };
    const adjusted = { units: base.units + blocks.units };
    const previous = lastYear.get(shiftMonth(monthYear, -12)) ?? null;
    return {
      month_year: monthYear,
      lastYear: previous,
      model: base,
      blocks,
      adjusted,
      variance: variance(adjusted, previous),
      items: (monthItems.get(monthYear) ?? []).map(({ itemId, name }) => ({ itemId, name })),
    };
  });
}
