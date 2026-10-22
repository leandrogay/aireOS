// ============================================================
// SCENARIO ENGINE -- pure, no React
// ============================================================
//
// One engine for the Scenario builder (see the Forecast Simulator
// blueprint, Part 6). Every source (building blocks, draft promotions)
// turns its items into DELTA CELLS, and everything on the page --
// chart line, year totals, pitch card, impact table -- reads only these
// cells, never the items themselves. That keeps the two sources independent:
// either can return [] without breaking the page.
//
// A delta cell, one per item x customer x SKU x month:
//   {
//     itemId, source,              // which item, and which source made it
//     customer, sku, month_year,   // customer_name / product_name / 'YYYY-MM-01', as on forecast rows
//     baseUnits, baseRevenue,      // the Current forecast for this cell
//     deltaUnits, deltaRevenue,    // what the item adds on top of it
//   }
//
// A source (registered in scenarioSources.js):
//   {
//     key,                          // 'blocks' | 'promotions'
//     itemsKey,                     // where its items live, e.g. items.blocks
//     deltas(items, rows, view) => DeltaCell[],   // view = chartView(), see below
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

// The forecast rows an item applies to: its customer, its SKU (or every SKU
// when sku === ''), its months, and only rows with a Current value (months
// with actuals have none, so they are never changed).
function itemRows(rows, item) {
  if (!item.customer || !item.startMonth || !item.endMonth) return [];
  return rows.filter(
    (row) =>
      row[CURRENT_UNITS] != null &&
      row.customer_name === item.customer &&
      (!item.sku || row.product_name === item.sku) &&
      row.month_year >= item.startMonth &&
      row.month_year <= item.endMonth
  );
}

function deltaCell(row, item, source, deltaUnits) {
  const baseUnits = row[CURRENT_UNITS];
  const baseRevenue = row[CURRENT_REVENUE] ?? null;
  // Added units are priced like the row's own Current units, i.e. this
  // customer's price for this SKU.
  const price = baseRevenue != null && baseUnits ? baseRevenue / baseUnits : null;
  return {
    itemId: item.id,
    source,
    customer: row.customer_name,
    sku: row.product_name,
    month_year: row.month_year,
    baseUnits,
    baseRevenue,
    deltaUnits,
    deltaRevenue: price == null ? null : deltaUnits * price,
  };
}

/**
 * The page's chart filters, in the shape a source's deltas() receives.
 *
 * @param {{ productName: string, customerName: string, startDate: string, endDate: string }} filters
 */
export function chartView({ productName = '', customerName = '', startDate = '', endDate = '' }) {
  return {
    productName,
    customerName,
    startMonth: startDate ? `${startDate.slice(0, 7)}-01` : '',
    endMonth: endDate ? `${endDate.slice(0, 7)}-01` : '',
  };
}

/**
 * True when the fetched rows hold every customer x SKU x month the item
 * covers. A fixed number of units is split by share of the whole item, so
 * it can only be split when nothing the item covers is filtered out.
 *
 * @param {object} item
 * @param {ReturnType<typeof chartView>} view
 */
export function viewCoversItem(item, view) {
  if (view.customerName && view.customerName !== item.customer) return false;
  if (view.productName && view.productName !== item.sku) return false;
  if (view.startMonth && item.startMonth < view.startMonth) return false;
  if (view.endMonth && item.endMonth > view.endMonth) return false;
  return true;
}

/**
 * Delta cells for one item that lifts the Current forecast by a flat %.
 * Shared by every uplift-style source, so building blocks and draft
 * promotions measure their impact the same way.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {{ id: string, customer: string, sku: string, startMonth: string, endMonth: string }} item
 * @param {number} upliftPct e.g. 18 for +18%
 * @param {string} source the source key, copied onto each cell
 */
export function upliftDeltaCells(rows, item, upliftPct, source) {
  const share = (Number(upliftPct) || 0) / 100;
  return itemRows(rows, item).map((row) => deltaCell(row, item, source, row[CURRENT_UNITS] * share));
}

/**
 * Delta cells for one item that adds a fixed number of units over its whole
 * date range. The units are split across its months and SKUs in proportion
 * to their Current forecast, so the seasonality and SKU mix stay as they
 * are; if Current is 0 everywhere, they are split evenly.
 *
 * Returns no cells unless the fetched rows cover the whole item (see
 * viewCoversItem): splitting over a filtered slice would pile every unit
 * into the part that happens to be on screen.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {{ id: string, customer: string, sku: string, startMonth: string, endMonth: string }} item
 * @param {number} units total units added across the item's months
 * @param {string} source the source key, copied onto each cell
 * @param {ReturnType<typeof chartView>} view
 */
export function unitsDeltaCells(rows, item, units, source, view) {
  if (!viewCoversItem(item, view)) return [];
  const matched = itemRows(rows, item);
  const total = Number(units) || 0;
  const baseTotal = matched.reduce((sum, row) => sum + row[CURRENT_UNITS], 0);
  return matched.map((row) => {
    const share = baseTotal > 0 ? row[CURRENT_UNITS] / baseTotal : 1 / matched.length;
    return deltaCell(row, item, source, total * share);
  });
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
 * The cells regrouped by month, then by item: Map month_year → Map itemId →
 * { baseUnits, baseRevenue, deltaUnits, deltaRevenue }. For the chart
 * tooltip (which blocks add to a month), the comparison table (how many
 * blocks are active in a period) and the blocks table's by-month detail.
 *
 * @param {object[]} cells simulate().cells
 */
export function cellsByMonth(cells) {
  const months = new Map();
  for (const cell of cells) {
    if (!months.has(cell.month_year)) months.set(cell.month_year, new Map());
    const items = months.get(cell.month_year);
    if (!items.has(cell.itemId)) {
      items.set(cell.itemId, { baseUnits: 0, baseRevenue: 0, deltaUnits: 0, deltaRevenue: 0 });
    }
    const entry = items.get(cell.itemId);
    entry.baseUnits += cell.baseUnits;
    entry.baseRevenue += cell.baseRevenue ?? 0;
    entry.deltaUnits += cell.deltaUnits;
    entry.deltaRevenue += cell.deltaRevenue ?? 0;
  }
  return months;
}

/**
 * Run every source over its items and total the cells by month and by item.
 *
 * `byItem` only holds items that produced at least one cell. An item missing
 * from it is outside the rows the page fetched (another customer or SKU than
 * the filters, or months outside the date range), so the page labels it
 * "outside chart filters" with no numbers (blueprint Part 4.6).
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {Record<string, object[]>} items items per source, e.g. { blocks: [], promotions: [] }
 * @param {object[]} sources SCENARIO_SOURCES
 * @param {ReturnType<typeof chartView>} view the chart filters the rows were fetched with
 */
export function simulate(rows, items, sources, view) {
  const cells = sources.flatMap((source) => source.deltas(items[source.itemsKey] ?? [], rows, view));
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
 * Year totals with the items' deltas added to the forecast side, for the
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
