// ============================================================
// SCENARIO ENGINE -- pure, no React
// ============================================================
//
// One engine for the Scenario builder (see the Forecast Simulator
// blueprint, Part 6). Every source (building blocks, draft promotions)
// turns its draft items into DELTA CELLS, and everything on the page --
// chart line, year totals, pitch card, impact table -- reads only these
// cells, never the items themselves. That keeps the two sources independent:
// either can return [] without breaking the page.
//
// A delta cell, one per item x customer x SKU x month:
//   {
//     itemId, source,              // which draft item, and which source made it
//     customer, sku, month_year,   // customer_name / product_name / 'YYYY-MM-01', as on forecast rows
//     baseUnits, baseRevenue,      // the Current forecast for this cell
//     deltaUnits, deltaRevenue,    // what the item adds on top of it
//   }
//
// A source (registered in scenarioSources.js):
//   {
//     key,                          // 'blocks' | 'promotions'
//     itemsKey,                     // where its items live on the draft
//     deltas(items, rows) => DeltaCell[],
//     describe(item) => { title, subtitle, explanation }
//   }
//
// Every uplift is measured against the Current forecast only, never against
// Current plus other items, so uplifts simply add up (blueprint Part 5.4).

// Same colour as --aire-scenario in globals.css; recharts needs the value
// itself, as the committed lines in forecastView.js do.
export const SIMULATED_SERIES = {
  key: 'simulated',
  label: 'Simulated',
  color: '#D23F74',
  dash: '7 4',
  shape: 'circle',
  connectNulls: false,
};

// Revenue uses the realised price already on each forecast row (backend
// forecast_service.add_forecast_revenue), the same price the chart's Revenue
// tab shows. Whether to switch to list price is open question 2.
const CURRENT_UNITS = 'forecast_current';
const CURRENT_REVENUE = 'forecast_current_revenue';

/**
 * Delta cells for one item that lifts the Current forecast by a flat %.
 * Shared by every uplift-style source, so building blocks and draft
 * promotions measure their impact the same way.
 *
 * An item matches a forecast row when the customer matches, the SKU matches
 * (or the item covers all SKUs, sku === ''), and the month is inside the
 * item's range. Rows with no Current value (months with actuals) are skipped.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {{ id: string, customer: string, sku: string, startMonth: string, endMonth: string }} item
 * @param {number} upliftPct e.g. 18 for +18%
 * @param {string} source the source key, copied onto each cell
 */
export function upliftDeltaCells(rows, item, upliftPct, source) {
  const cells = [];
  if (!item.customer || !item.startMonth || !item.endMonth) return cells;
  const share = (Number(upliftPct) || 0) / 100;

  for (const row of rows) {
    const baseUnits = row[CURRENT_UNITS];
    if (baseUnits == null) continue;
    if (row.customer_name !== item.customer) continue;
    if (item.sku && row.product_name !== item.sku) continue;
    if (row.month_year < item.startMonth || row.month_year > item.endMonth) continue;

    const baseRevenue = row[CURRENT_REVENUE] ?? null;
    cells.push({
      itemId: item.id,
      source,
      customer: row.customer_name,
      sku: row.product_name,
      month_year: row.month_year,
      baseUnits,
      baseRevenue,
      deltaUnits: baseUnits * share,
      deltaRevenue: baseRevenue == null ? null : baseRevenue * share,
    });
  }
  return cells;
}

function addTo(totals, key, cell) {
  if (!totals.has(key)) {
    totals.set(key, { baseUnits: 0, baseRevenue: 0, deltaUnits: 0, deltaRevenue: 0, months: [] });
  }
  const entry = totals.get(key);
  entry.baseUnits += cell.baseUnits;
  entry.baseRevenue += cell.baseRevenue ?? 0;
  entry.deltaUnits += cell.deltaUnits;
  entry.deltaRevenue += cell.deltaRevenue ?? 0;
  if (!entry.months.includes(cell.month_year)) entry.months.push(cell.month_year);
  return entry;
}

/**
 * Run every source over the draft and total the cells by month and by item.
 *
 * `byItem` only holds items that produced at least one cell. An item missing
 * from it is outside the rows the page fetched (another customer or SKU than
 * the filters, or months outside the date range), so the page labels it
 * "outside chart filters" with no numbers (blueprint Part 4.6).
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {Record<string, object[]>} draft items per source, e.g. { blocks: [], promotions: [] }
 * @param {object[]} sources SCENARIO_SOURCES
 */
export function simulate(rows, draft, sources) {
  const cells = sources.flatMap((source) => source.deltas(draft[source.itemsKey] ?? [], rows));
  const byMonth = new Map();
  const byItem = new Map();
  for (const cell of cells) {
    addTo(byMonth, cell.month_year, cell);
    addTo(byItem, cell.itemId, cell);
  }
  for (const entry of byItem.values()) entry.months.sort();
  return { cells, byMonth, byItem };
}

/**
 * Chart points with the Simulated line added: Current + this month's deltas,
 * wherever there is a Current value. `simulatedGap` is the [Current,
 * Simulated] pair the chart shades between the two lines.
 *
 * @param {object[]} points buildMonthlyPoints output for one metric
 * @param {Map} byMonth simulate().byMonth
 * @param {'units'|'revenue'} metric
 */
export function withSimulatedLine(points, byMonth, metric) {
  return points.map((point) => {
    if (point.current == null) return { ...point, simulated: null, simulatedGap: null };
    const totals = byMonth.get(point.month_year);
    const delta = totals ? (metric === 'revenue' ? totals.deltaRevenue : totals.deltaUnits) : 0;
    const simulated = point.current + delta;
    return { ...point, simulated, simulatedGap: [point.current, simulated] };
  });
}

/**
 * Year totals with the draft's deltas added to the forecast side, for the
 * "Simulated" rows under the year table. Same shape as buildYearlyTotals.
 *
 * @param {object[]} years buildYearlyTotals output
 * @param {Map} byMonth simulate().byMonth
 */
export function simulatedYearTotals(years, byMonth) {
  return years.map((year) => {
    let units = 0;
    let revenue = 0;
    for (const [monthYear, totals] of byMonth) {
      if (monthYear.slice(0, 4) !== year.year) continue;
      units += totals.deltaUnits;
      revenue += totals.deltaRevenue;
    }
    const plus = (value, delta) => (value == null ? (delta ? delta : null) : value + delta);
    return {
      ...year,
      volume: {
        actual: year.volume.actual,
        forecast: plus(year.volume.forecast, units),
        total: plus(year.volume.total, units),
      },
      revenue: {
        actual: year.revenue.actual,
        forecast: plus(year.revenue.forecast, revenue),
        total: plus(year.revenue.total, revenue),
      },
      deltaUnits: units,
      deltaRevenue: revenue,
    };
  });
}

/**
 * Months an item may cover: those with a Current forecast in the fetched
 * rows. Months with actuals are locked (blueprint Part 1.2).
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 */
export function forecastMonths(rows) {
  const months = new Set();
  for (const row of rows) {
    if (row[CURRENT_UNITS] != null && row.month_year) months.add(row.month_year);
  }
  return [...months].sort();
}

/**
 * One pin per item, at the first month it changes in the fetched rows.
 *
 * @param {Map} byItem simulate().byItem
 */
export function itemMarkers(byItem) {
  return [...byItem.entries()].map(([itemId, totals]) => ({
    key: itemId,
    month_year: totals.months[0],
  }));
}
