// ============================================================
// SCENARIO MONTHLY PLAN -- pure, no React
// ============================================================
//
// The Scenario builder's planning view: one row per forecast month, summed
// over whatever the filters select (one SKU, or all SKUs and customers),
// with Last year actual, Model forecast (the Current line, Tier 0), what
// makes up the Adjusted forecast (= the Simulated line) part by part, in
// units (the scenario predicts volume only), plus the variance of Adjusted
// against last year. Months with actuals are left out: blocks only apply to
// forecast months.

import { planStatus } from './scenarioTier0Split.js';

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

// The Promotions column of one month: what last year's promotions still add
// (with the months and mechanics behind them) and what the official ones
// planned add in their place. A part left out in the Breakdown tab has no
// line; with official promotions left out, last year's carry on in their
// months too.
function promotionLines(parts, split, { carriedOn, officialOn }) {
  if (!parts || !split?.splitRows) return [];
  const lines = [];
  if (carriedOn && Math.round(parts.carried)) {
    const sources = officialOn ? split.carriedPromotions.unplanned : split.carriedPromotions.all;
    lines.push({ kind: 'carried', units: parts.carried, sources });
  }
  if (officialOn && split.official.plannedRows) {
    lines.push({ kind: 'official', units: parts.official, mechanics: split.official.mechanics });
  }
  return lines;
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
 *     parts: { baseline, carried, official, growth, blocks, promotions } | null,
 *                                            // what Adjusted is made of (they add up to it
 *                                            // before the 0 floor); null with no breakdown
 *     promotionLines: [{ kind: 'carried', units, sources: [{ kind: 'lastYear' | 'runRate', months, mechanics }] }
 *                    | { kind: 'official', units, mechanics }],  // the Promotions column
 *     planStatus: 'planned' | 'partly' | 'not_planned' | null,   // scenarioTier0Split.planStatus
 *     variance: { units, unitsPct } | null,
 *     items: [{ itemId, name, state, source }], // what adds to this month; state 'saved' | 'draft' | 'edited'
 *   }
 *
 * @param {{
 *   rows: object[],               forecast rows from GET /api/forecast
 *   lastYearActuals: object[],    actuals for the months 12 months earlier
 *   byMonth: Map,                 simulate().byMonth
 *   monthItems: Map,              month_year → [{ itemId, name, state }]
 *   breakdowns?: Map,             month_year → the chart point's breakdown (scenarioComposition.withComposition)
 *   splits?: Map,                 month_year → scenarioTier0Split.monthSplit
 *   included?: Record<string, boolean>, the Breakdown tab's toggles (carried, official)
 * }} input
 */
export function buildPlanRows({
  rows,
  lastYearActuals,
  byMonth,
  monthItems,
  breakdowns = new Map(),
  splits = new Map(),
  included = { carried: true, official: true },
}) {
  const model = totalsByMonth(rows, CURRENT_UNITS);
  const lastYear = totalsByMonth(lastYearActuals, 'quantity_cartons');

  return [...model.keys()].sort().map((monthYear) => {
    const base = model.get(monthYear);
    const delta = byMonth.get(monthYear);
    const blocks = { units: delta?.deltaUnits ?? 0 };
    const adjusted = { units: base.units + blocks.units };
    const previous = lastYear.get(shiftMonth(monthYear, -12)) ?? null;
    const breakdown = breakdowns.get(monthYear);
    const split = splits.get(monthYear) ?? null;
    const parts = breakdown
      ? {
          baseline: breakdown.baseline,
          carried: breakdown.carried,
          official: breakdown.officialAdded ?? 0,
          growth: breakdown.growth,
          blocks: breakdown.blocks,
          promotions: breakdown.promotionsAdded ?? breakdown.promotions,
        }
      : null;
    return {
      month_year: monthYear,
      lastYear: previous,
      model: base,
      blocks,
      adjusted,
      variance: variance(adjusted, previous),
      parts,
      promotionLines: promotionLines(parts, split, {
        carriedOn: included.carried !== false,
        officialOn: included.official !== false,
      }),
      planStatus: planStatus(split),
      items: (monthItems.get(monthYear) ?? []).map(({ itemId, name, state, source }) => ({ itemId, name, state, source })),
    };
  });
}
