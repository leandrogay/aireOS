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
//     baseUnits,                   // the Current forecast for this cell
//     deltaUnits,                  // what the item adds on top of it
//     addedUnits, replacedUnits,   // promotions only: what they add, and the part of
//                                  // what Tier 0 carries they replace (deltaUnits =
//                                  // added - replaced; scenarioTier0Split.js)
//   }
//
// Volume only: the Scenario builder predicts units, never revenue. A
// promotion's discount changes the price as well as the volume, and the
// forecast's realised price can't tell how, so a revenue figure would be
// overstated by the depth of every discount.
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
// A decrease (a negative uplift) can't take a customer x SKU x month below 0
// units: simulate() scales that cell's decreases down to fit (floorAtZero).
//
// The sell-in plan chart's building blocks overlay applies saved blocks with
// the same rules on the backend (app/services/scenario/block_effects.py),
// since the plan is worked out there. Change the two together.

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

const CURRENT_UNITS = 'forecast_current';

/**
 * The customers an item covers, [] meaning every customer: a building
 * block names a list (`customers`, migration 022); a promotion still names
 * one (`customer`). null when it names none yet (a draft being set up).
 *
 * @param {{ customers?: string[], customer?: string }} item
 * @returns {string[] | null}
 */
export function itemCustomers(item) {
  if (Array.isArray(item.customers)) return item.customers;
  return item.customer ? [item.customer] : null;
}

/**
 * Whether an item covers a customer (it names it, or covers every customer).
 *
 * @param {object} item
 * @param {string} customerName
 */
export function coversCustomer(item, customerName) {
  const customers = itemCustomers(item);
  return Boolean(customers) && (!customers.length || customers.includes(customerName));
}

// The forecast rows an item applies to: its customers, its SKU ranges (every
// SKU of them, by the rows' sku_range) or its one SKU (items saved before
// ranges; every SKU when neither is set), its months, and only rows with a
// Current value (months with actuals have none, so they are never changed).
export function itemRows(rows, item) {
  if (!itemCustomers(item) || !item.startMonth || !item.endMonth) return [];
  return rows.filter(
    (row) =>
      row[CURRENT_UNITS] != null &&
      coversCustomer(item, row.customer_name) &&
      (!item.skuRanges?.length || item.skuRanges.includes(row.sku_range)) &&
      (!item.sku || row.product_name === item.sku) &&
      row.month_year >= item.startMonth &&
      row.month_year <= item.endMonth
  );
}

function deltaCell(row, item, source, deltaUnits) {
  return {
    itemId: item.id,
    source,
    customer: row.customer_name,
    sku: row.product_name,
    month_year: row.month_year,
    baseUnits: row[CURRENT_UNITS],
    deltaUnits,
  };
}

/**
 * The page's chart filters, in the shape a source's deltas() receives.
 *
 * `splitBasis` (optional) holds forecast rows fetched beyond the filters so
 * a units item can still be split when the filters show only part of it:
 * Map customer_name → { startMonth, endMonth, rows } with every SKU of that
 * customer over those months (see useUnitsSplitBasis).
 *
 * `tier0Split` (optional) is Tier 0 split into its baseline and the
 * promotions it carries (scenarioTier0Split.tier0SplitIndex), which the
 * official and scenario promotions are worked out on.
 *
 * @param {{ productName?: string, skuRange?: string, customerName: string, startDate: string, endDate: string }} filters
 * @param {Map<string, { startMonth: string, endMonth: string, rows: object[] }>} [splitBasis]
 * `officialOn` / `promotions` say what Simulated counts (the Breakdown
 * tab's toggles): whether official promotions replace what Tier 0 carries,
 * and the scenario promotions that do where they don't.
 *
 * @param {Map<string, object>} [tier0Split]
 * @param {{ officialOn?: boolean, promotions?: object[] }} [counted]
 */
export function chartView(
  { productName = '', skuRange = '', customerName = '', startDate = '', endDate = '' },
  splitBasis = null,
  tier0Split = null,
  { officialOn = true, promotions = [] } = {}
) {
  return {
    productName,
    skuRange,
    customerName,
    startMonth: startDate ? `${startDate.slice(0, 7)}-01` : '',
    endMonth: endDate ? `${endDate.slice(0, 7)}-01` : '',
    splitBasis,
    tier0Split,
    officialOn,
    promotions,
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
  // One customer in view covers only an item for exactly that customer.
  const customers = itemCustomers(item) ?? [];
  if (view.customerName && !(customers.length === 1 && customers[0] === view.customerName)) return false;
  if (view.productName && view.productName !== item.sku) return false;
  // A range in view covers only an item for exactly that range; an item on
  // more ranges, all of them, or one SKU reaches beyond what the view fetched.
  if (view.skuRange && !(item.skuRanges?.length === 1 && item.skuRanges[0] === view.skuRange)) return false;
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

// The rows a units item is split over: the item's whole scope. The page's
// rows when the filters show all of it; otherwise the split basis fetched for
// its customer, if that covers the item's months; otherwise none (still
// loading), since splitting over a filtered slice would pile every unit into
// the part that happens to be on screen.
function splitRowsFor(rows, item, view) {
  if (viewCoversItem(item, view)) return rows;
  const basis = view.splitBasis?.get(itemCustomers(item)?.[0]);
  if (basis && basis.startMonth <= item.startMonth && basis.endMonth >= item.endMonth) return basis.rows;
  return null;
}

// A units item for each customer it covers that the page's rows hold: each
// customer gets the full number of units, split over its own SKUs and months.
// An item for every customer covers the customers in the rows.
function perCustomer(rows, item) {
  const customers = itemCustomers(item);
  if (!customers) return [];
  const names = customers.length ? customers : [...new Set(rows.map((row) => row.customer_name))];
  return names.map((customer) => ({ ...item, customers: [customer] }));
}

/**
 * Units items whose split needs rows beyond the page's filters, as
 * { customer: { startMonth, endMonth } } spanning all of that customer's
 * such items: what useUnitsSplitBasis fetches.
 *
 * @param {object[]} items switched-on items
 * @param {ReturnType<typeof chartView>} view
 * @param {object[]} [rows] the page's forecast rows: the customers an item for every customer covers
 */
export function splitBasisNeeds(items, view, rows = []) {
  const needs = {};
  for (const item of items) {
    if (item.upliftMode !== 'units' || !item.startMonth || !item.endMonth) continue;
    for (const one of perCustomer(rows, item)) {
      const [customer] = one.customers;
      // Another customer than the one in view adds no cells to the page.
      if (view.customerName && customer !== view.customerName) continue;
      if (viewCoversItem(one, view)) continue;
      const need = needs[customer];
      needs[customer] = {
        startMonth: need && need.startMonth < item.startMonth ? need.startMonth : item.startMonth,
        endMonth: need && need.endMonth > item.endMonth ? need.endMonth : item.endMonth,
      };
    }
  }
  return needs;
}

/**
 * Delta cells for one item that adds a fixed number of units over its whole
 * date range, to each customer it covers (each gets the full number). The
 * units are split across that customer's months and SKUs in proportion to
 * their Current forecast, so the seasonality and SKU mix stay as they are;
 * if Current is 0 everywhere, they are split evenly.
 *
 * The split is always over the item's whole scope (splitRowsFor), and cells
 * are returned only for the page's rows, so an All SKUs block shows its
 * share for the one SKU in view, and a block running past the period shows
 * its in-period months. No cells while the split's rows are loading.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {{ id: string, customer: string, sku: string, startMonth: string, endMonth: string }} item
 * @param {number} units total units added across the item's months
 * @param {string} source the source key, copied onto each cell
 * @param {ReturnType<typeof chartView>} view
 */
export function unitsDeltaCells(rows, item, units, source, view) {
  const total = Number(units) || 0;
  return perCustomer(itemRows(rows, item), item).flatMap((one) => {
    const splitRows = splitRowsFor(rows, one, view);
    if (!splitRows) return [];
    const scope = itemRows(splitRows, one);
    const baseTotal = scope.reduce((sum, row) => sum + row[CURRENT_UNITS], 0);
    // Cells keep the item's own id (`one` differs only in its customers).
    return itemRows(rows, one).map((row) => {
      const share = baseTotal > 0 ? row[CURRENT_UNITS] / baseTotal : 1 / scope.length;
      return deltaCell(row, item, source, total * share);
    });
  });
}

function addTo(totals, key, cell) {
  if (!totals.has(key)) {
    totals.set(key, { baseUnits: 0, deltaUnits: 0, months: [] });
  }
  const entry = totals.get(key);
  entry.baseUnits += cell.baseUnits;
  entry.deltaUnits += cell.deltaUnits;
  if (!entry.months.includes(cell.month_year)) entry.months.push(cell.month_year);
  return entry;
}

/**
 * The cells regrouped by month, then by item: Map month_year → Map itemId →
 * { source, baseUnits, deltaUnits, addedUnits, replacedUnits }. For the chart
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
      items.set(cell.itemId, { source: cell.source, baseUnits: 0, deltaUnits: 0, addedUnits: 0, replacedUnits: 0 });
    }
    const entry = items.get(cell.itemId);
    entry.baseUnits += cell.baseUnits;
    entry.deltaUnits += cell.deltaUnits;
    entry.addedUnits += cell.addedUnits ?? cell.deltaUnits;
    entry.replacedUnits += cell.replacedUnits ?? 0;
  }
  return months;
}

// The cells for one customer x SKU x month with their decreases scaled down,
// all by the same share, so the increases and decreases together never take
// the Current forecast below 0. `capped` marks a scaled cell.
function floorAtZero(cells) {
  const base = cells[0].baseUnits;
  const added = cells.reduce((sum, cell) => sum + Math.max(0, cell.deltaUnits), 0);
  const removed = cells.reduce((sum, cell) => sum + Math.min(0, cell.deltaUnits), 0);
  if (base + added + removed >= 0) return cells;
  const share = -(base + added) / removed;
  return cells.map((cell) =>
    cell.deltaUnits < 0
      ? {
          ...cell,
          deltaUnits: cell.deltaUnits * share,
          ...(cell.addedUnits != null ? { addedUnits: cell.addedUnits * share, replacedUnits: cell.replacedUnits * share } : {}),
          capped: true,
        }
      : cell
  );
}

function withFloor(cells) {
  const byRow = new Map();
  for (const cell of cells) {
    const key = `${cell.customer}|${cell.sku}|${cell.month_year}`;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(cell);
  }
  return [...byRow.values()].flatMap(floorAtZero);
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
  const cells = withFloor(sources.flatMap((source) => source.deltas(items[source.itemsKey] ?? [], rows, view)));
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
 * @param {object[]} points buildMonthlyPoints(..., 'units')
 * @param {Map} byMonth simulate().byMonth
 */
export function withSimulatedLine(points, byMonth) {
  return points.map((point) => {
    if (point.current == null) return { ...point, simulated: null, simulatedGap: null };
    const simulated = point.current + (byMonth.get(point.month_year)?.deltaUnits ?? 0);
    return { ...point, simulated, simulatedGap: [point.current, simulated] };
  });
}

/**
 * Year totals with the items' deltas added to the forecast side's volume,
 * for the comparison table under the chart. Same shape as buildYearlyTotals;
 * revenue is left as it is, since the scenario predicts volume only.
 *
 * @param {object[]} years buildYearlyTotals output
 * @param {Map} byMonth simulate().byMonth
 */
export function simulatedYearTotals(years, byMonth) {
  return years.map((year) => {
    let units = 0;
    for (const [monthYear, totals] of byMonth) {
      if (monthYear.slice(0, 4) !== year.year) continue;
      units += totals.deltaUnits;
    }
    const plus = (value, delta) => (value == null ? (delta ? delta : null) : value + delta);
    return {
      ...year,
      volume: {
        actual: year.volume.actual,
        forecast: plus(year.volume.forecast, units),
        total: plus(year.volume.total, units),
      },
      deltaUnits: units,
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
