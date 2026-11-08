// What the Actual line knows about each month, and how much of a selection a
// forecast line covers. Pure and alias-free so `npm test` (node --test) can
// check it; wording comes from forecastLineText.js.
//
// Each forecast row carries actual_status for its customer x SKU x month
// (backend bigquery.ACTUAL_STATUSES, the same on every tier):
//   reported           the customer sent the month; a SKU with no sales row
//                      sold nothing, which is a real 0
//   missing_file       the customer sent later months but not this one
//   not_yet            after the customer's latest month (still forecast)
//   before_first_sale  before the SKU's first sale (nothing to say)
// A missing month is never 0: it has no Actual point, and the Actual line is
// joined across it with a dashed segment. Statuses only exist for months in
// the forecast window; older history keeps showing gaps without a label.
//
// Actual values themselves come from GET /api/forecast `actuals` (monthly
// sales), matched to a customer x SKU by customer_id + sku. Actuals and
// forecasts are never added into one number: a month where some SKUs have
// an actual and others are still forecast keeps them as separate series.

import {
  ACTUAL_MISSING_TEXT,
  actualPartialMissingText,
  actualsStillForecastText,
  previousMadeLines,
} from './forecastLineText.js';

export const ACTUAL_STATUS = {
  reported: 'reported',
  missingFile: 'missing_file',
  notYet: 'not_yet',
  beforeFirstSale: 'before_first_sale',
};

/** One customer x SKU, the unit a line can or can't cover. */
export function seriesKey(row) {
  return `${row.customer_id}|${row.sku}`;
}

function seriesOf(row) {
  return {
    key: seriesKey(row),
    customerName: row.customer_name ?? '',
    productName: row.product_name ?? row.sku ?? '',
  };
}

/**
 * Per month, which customer x SKUs in `rows` (one tier's rows) reported an
 * actual, are missing their file, or are still forecast (not_yet with a
 * Current value). A series counts once per month.
 *
 * @param {object[]} rows
 * @returns {Map<string, { reported: object[], missing: object[], waiting: object[] }>}
 */
export function actualCoverageByMonth(rows) {
  const byMonth = new Map();
  const seen = new Set();
  for (const row of rows ?? []) {
    if (!row.month_year) continue;
    const id = `${row.month_year}|${seriesKey(row)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!byMonth.has(row.month_year)) byMonth.set(row.month_year, { reported: [], missing: [], waiting: [] });
    const month = byMonth.get(row.month_year);
    if (row.actual_status === ACTUAL_STATUS.reported) month.reported.push(seriesOf(row));
    else if (row.actual_status === ACTUAL_STATUS.missingFile) month.missing.push(seriesOf(row));
    else if (row.actual_status === ACTUAL_STATUS.notYet && row.forecast_current != null) month.waiting.push(seriesOf(row));
  }
  return byMonth;
}

/**
 * How complete a month's Actual is:
 *   'full'     every series in scope reported
 *   'partial'  some reported; others are missing a file or still forecast
 *   'missing'  none reported and at least one is missing its file
 *   null       nothing known (history before the window, or only not-yet /
 *              before-first-sale months)
 */
export function actualKind(coverage) {
  if (!coverage) return null;
  const { reported, missing, waiting } = coverage;
  if (!reported.length) return missing.length ? 'missing' : null;
  return missing.length || waiting.length ? 'partial' : 'full';
}

// Actual rows name the SKU (backend _actual_row); older payloads only the
// product, so that is the fallback match.
function actualKeys(row) {
  return [`${row.customer_id}|${row.sku}`, `${row.customer_id}|name:${row.product_name}`];
}

function reportedKeys(series) {
  const [customerId] = series.key.split('|');
  return [series.key, `${customerId}|name:${series.productName}`];
}

/**
 * The Actual for each month in cartons, summed over the SKUs in scope, with
 * its coverage and kind. A reported customer x SKU with no sales row adds a
 * real 0 (so one SKU that sold nothing still shows 0, not a gap); a missing
 * month stays null whatever else is in scope.
 *
 * @param {object[]} rows one tier's forecast rows
 * @param {object[]} actuals GET /api/forecast actuals
 * @returns {Map<string, { value: number | null, kind: string | null, coverage: object | null }>}
 */
export function monthlyActuals(rows, actuals) {
  const coverageByMonth = actualCoverageByMonth(rows);
  const result = new Map();
  const matched = new Map();

  for (const row of actuals ?? []) {
    if (!row.month_year) continue;
    const value = row.quantity_cartons ?? null;
    if (!result.has(row.month_year)) result.set(row.month_year, { value: null, kind: null, coverage: null });
    if (!matched.has(row.month_year)) matched.set(row.month_year, new Set());
    for (const key of actualKeys(row)) matched.get(row.month_year).add(key);
    if (value == null) continue;
    const entry = result.get(row.month_year);
    entry.value = (entry.value ?? 0) + value;
  }

  for (const [month, coverage] of coverageByMonth) {
    if (!result.has(month)) result.set(month, { value: null, kind: null, coverage: null });
    const entry = result.get(month);
    entry.coverage = coverage;
    entry.kind = actualKind(coverage);
    const keys = matched.get(month) ?? new Set();
    const realZero = coverage.reported.some((series) => !reportedKeys(series).some((key) => keys.has(key)));
    if (realZero) entry.value = entry.value ?? 0;
    if (entry.kind === 'missing') entry.value = null;
  }
  return result;
}

/**
 * The dashed segments that join the Actual line across months with no
 * actual. The solid Actual line breaks at each gap (connectNulls off), and
 * each gap gets its own key holding only the two actuals either side, so a
 * segment never runs across a stretch the solid line already draws.
 *
 * @param {object[]} points chart points in month order, with `actual`
 * @returns {{ points: object[], keys: string[] }}
 */
export function withActualBridges(points) {
  const withActual = (points ?? []).map((point, index) => ({ index, has: point.actual != null }));
  const bridged = (points ?? []).map((point) => ({ ...point }));
  const keys = [];
  let last = -1;
  for (const { index, has } of withActual) {
    if (!has) continue;
    if (last >= 0 && index - last > 1) {
      const key = `actualBridge${keys.length}`;
      keys.push(key);
      bridged[last][key] = bridged[last].actual;
      bridged[index][key] = bridged[index].actual;
    }
    last = index;
  }
  return { points: bridged, keys };
}

/**
 * How many customer x SKUs in scope have any value in `column`
 * (forecast_initial / forecast_previous) on the shown tier.
 *
 * @returns {{ withLine: number, total: number }}
 */
export function lineCoverage(rows, column) {
  const all = new Set();
  const covered = new Set();
  for (const row of rows ?? []) {
    const key = seriesKey(row);
    all.add(key);
    if (row[column] != null) covered.add(key);
  }
  return { withLine: covered.size, total: all.size };
}

/**
 * When each month's Previous values were made: one entry per customer x SKU
 * with a Previous that month. Previous is chosen per SKU, so the dates can
 * differ between SKUs.
 *
 * @returns {Map<string, { productName: string, customerName: string, at: string }[]>}
 */
export function previousMadeByMonth(rows) {
  const byMonth = new Map();
  for (const row of rows ?? []) {
    if (!row.month_year || row.forecast_previous == null || !row.previous_generated_at) continue;
    if (!byMonth.has(row.month_year)) byMonth.set(row.month_year, []);
    byMonth.get(row.month_year).push({
      productName: row.product_name ?? row.sku ?? '',
      customerName: row.customer_name ?? '',
      at: row.previous_generated_at,
    });
  }
  return byMonth;
}

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

function monthName(monthYear) {
  return MONTH_NAME.format(new Date(`${monthYear.slice(0, 10)}T00:00:00Z`));
}

/**
 * The tooltip lines about a month's Actual and Previous. `formatCustomer`
 * shows a customer slug (retailerLabel), `formatStamp` a Previous time
 * (Singapore time). Empty when there is nothing to explain.
 *
 * @param {{ month_year: string, actualKind?: string | null, actualCoverage?: object | null, previousMade?: object[], previous?: number | null }} point
 * @param {{ formatCustomer: (name: string) => string, formatStamp: (stamp: string) => string, showPrevious?: boolean }} options
 * @returns {{ label: string, value: string }[]}
 */
export function monthNotes(point, { formatCustomer, formatStamp, showPrevious = true }) {
  if (!point) return [];
  const notes = [];
  const coverage = point.actualCoverage;
  if (point.actualKind === 'missing') {
    notes.push({ label: 'Actual', value: ACTUAL_MISSING_TEXT });
  } else if (point.actualKind === 'partial') {
    if (coverage.missing.length) {
      const customers = [...new Set(coverage.missing.map((series) => formatCustomer(series.customerName)))];
      notes.push({ label: 'Actual', value: actualPartialMissingText(customers) });
    }
    if (coverage.waiting.length) {
      notes.push({
        label: 'Actual',
        value: actualsStillForecastText({
          reported: coverage.reported.length,
          waiting: coverage.waiting.length,
          month: monthName(point.month_year),
        }),
      });
    }
  }
  if (showPrevious && point.previous != null && point.previousMade?.length) {
    for (const value of previousMadeLines(point.previousMade, formatStamp)) {
      notes.push({ label: 'Previous', value });
    }
  }
  return notes;
}
