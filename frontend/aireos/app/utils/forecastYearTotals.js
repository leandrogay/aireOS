// Calendar-year volume totals for the cards under the forecast chart. Pure
// and alias-free so `npm test` (node --test) can check it.
//
// A year in progress is part history, part forecast. Each customer x SKU x
// month counts exactly once: its Actual when that customer x SKU has one,
// otherwise its Current forecast. The choice is made per customer x SKU, not
// per month: in a month where one customer has reported and another is still
// forecast (All customers), both count -- one as actual, one as forecast.

import { ACTUAL_STATUS } from './forecastActuals.js';

function cellKey(row) {
  return `${row.customer_id}|${row.sku}|${row.month_year}`;
}

function yearEntry(byYear, year) {
  if (!byYear.has(year)) {
    byYear.set(year, { year, months: new Map(), volume: { actual: null, forecast: null } });
  }
  return byYear.get(year);
}

function addVolume(entry, kind, monthYear, cartons) {
  entry.volume[kind] = (entry.volume[kind] ?? 0) + cartons;
  const marks = entry.months.get(monthYear) ?? new Set();
  marks.add(kind);
  entry.months.set(monthYear, marks);
}

/**
 * One total per calendar year, in cartons. `actualMonths` counts months that
 * are all actual, `forecastMonths` months that are all forecast and
 * `partialMonths` months that mix the two (some customer x SKUs reported,
 * others not yet).
 *
 * @param {object[]} rows one model's forecast rows (forecast_current, actual_status)
 * @param {object[]} actuals GET /api/forecast actuals (customer_id, sku, month_year, quantity_cartons)
 */
export function buildYearlyTotals(rows = [], actuals = []) {
  const actualCells = new Map();
  for (const row of actuals ?? []) {
    if (!row.month_year || row.quantity_cartons == null) continue;
    const key = cellKey(row);
    const cell = actualCells.get(key) ?? { cartons: 0, month_year: row.month_year };
    cell.cartons += row.quantity_cartons;
    actualCells.set(key, cell);
  }

  const forecastCells = new Map();
  for (const row of rows ?? []) {
    if (!row.month_year) continue;
    const key = cellKey(row);
    // Reported with no sales row: the SKU sold nothing that month, a real 0.
    if (row.actual_status === ACTUAL_STATUS.reported && !actualCells.has(key)) {
      actualCells.set(key, { cartons: 0, month_year: row.month_year });
    }
    if (row.forecast_current != null && !forecastCells.has(key)) {
      forecastCells.set(key, { cartons: row.forecast_current, month_year: row.month_year });
    }
  }

  const byYear = new Map();
  for (const cell of actualCells.values()) {
    addVolume(yearEntry(byYear, cell.month_year.slice(0, 4)), 'actual', cell.month_year, cell.cartons);
  }
  for (const [key, cell] of forecastCells) {
    // Sales already loaded for this customer x SKU x month: the actual counts.
    if (actualCells.has(key)) continue;
    addVolume(yearEntry(byYear, cell.month_year.slice(0, 4)), 'forecast', cell.month_year, cell.cartons);
  }

  return [...byYear.values()]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map(({ year, months, volume }) => {
      const kinds = [...months.values()];
      return {
        year,
        actualMonths: kinds.filter((marks) => marks.size === 1 && marks.has('actual')).length,
        forecastMonths: kinds.filter((marks) => marks.size === 1 && marks.has('forecast')).length,
        partialMonths: kinds.filter((marks) => marks.size === 2).length,
        volume: { ...volume, total: (volume.actual ?? 0) + (volume.forecast ?? 0) },
      };
    });
}
