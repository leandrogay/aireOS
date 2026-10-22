// ============================================================
// SCENARIO MONTHLY PLAN -- pure, no React
// ============================================================
//
// The Scenario builder's planning view: one row per forecast month, summed
// over whatever the filters select (one SKU, or all SKUs and customers),
// with Last year actual, Model forecast (the Current line), Building blocks
// applied and Adjusted forecast (= the Simulated line), each in units and
// revenue, plus the variance of Adjusted against last year. Months with actuals are left out: blocks only apply to
// forecast months.

const CURRENT_UNITS = 'forecast_current';
const CURRENT_REVENUE = 'forecast_current_revenue';

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

function emptyPair() {
  return { units: 0, revenue: 0 };
}

// Totals per month_year of two fields, or null for a month with no rows.
function totalsByMonth(rows, unitsKey, revenueKey) {
  const totals = new Map();
  for (const row of rows) {
    if (!row.month_year || row[unitsKey] == null) continue;
    if (!totals.has(row.month_year)) totals.set(row.month_year, emptyPair());
    const entry = totals.get(row.month_year);
    entry.units += row[unitsKey];
    entry.revenue += row[revenueKey] ?? 0;
  }
  return totals;
}

function variance(adjusted, lastYear) {
  if (!lastYear) return null;
  const units = adjusted.units - lastYear.units;
  const revenue = adjusted.revenue - lastYear.revenue;
  return {
    units,
    revenue,
    unitsPct: lastYear.units ? units / lastYear.units : null,
    revenuePct: lastYear.revenue ? revenue / lastYear.revenue : null,
  };
}

/**
 * One plan row per forecast month in the fetched rows.
 *
 *   {
 *     month_year,
 *     lastYear: { units, revenue } | null,   // null: no sales that month last year
 *     model: { units, revenue },             // Current forecast
 *     blocks: { units, revenue },            // switched-on items' uplift
 *     adjusted: { units, revenue },          // model + blocks
 *     variance: { units, revenue, unitsPct, revenuePct } | null,
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
  const model = totalsByMonth(rows, CURRENT_UNITS, CURRENT_REVENUE);
  const lastYear = totalsByMonth(lastYearActuals, 'quantity_cartons', 'revenue');

  return [...model.keys()].sort().map((monthYear) => {
    const base = model.get(monthYear);
    const delta = byMonth.get(monthYear);
    const blocks = { units: delta?.deltaUnits ?? 0, revenue: delta?.deltaRevenue ?? 0 };
    const adjusted = { units: base.units + blocks.units, revenue: base.revenue + blocks.revenue };
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
