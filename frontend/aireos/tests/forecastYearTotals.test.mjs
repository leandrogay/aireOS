// Calendar-year volume totals under the forecast chart
// (app/utils/forecastYearTotals.js). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildYearlyTotals } from '../app/utils/forecastYearTotals.js';

function row(customerId, month, extra = {}) {
  return {
    customer_id: customerId,
    sku: 'A',
    month_year: month,
    forecast_current: null,
    actual_status: 'not_yet',
    ...extra,
  };
}

function actual(customerId, month, cartons) {
  return { customer_id: customerId, sku: 'A', month_year: month, quantity_cartons: cartons };
}

describe('yearly totals', () => {
  test('one customer: actual months then forecast months', () => {
    const rows = [
      row(1, '2026-08-01', { actual_status: 'reported' }),
      row(1, '2026-09-01', { forecast_current: 300 }),
    ];
    const [year] = buildYearlyTotals(rows, [actual(1, '2026-08-01', 200)]);

    assert.deepEqual(year.volume, { actual: 200, forecast: 300, total: 500 });
    assert.deepEqual([year.actualMonths, year.partialMonths, year.forecastMonths], [1, 0, 1]);
  });

  test('a month where one customer reported keeps the other customer\'s forecast', () => {
    // All customers in September: customer 1 has sales, customer 2 is still
    // forecast. Both count -- the old per-month choice dropped customer 2.
    const rows = [
      row(1, '2026-09-01', { actual_status: 'reported' }),
      row(2, '2026-09-01', { forecast_current: 120 }),
    ];
    const [year] = buildYearlyTotals(rows, [actual(1, '2026-09-01', 80)]);

    assert.equal(year.volume.total, 200);
    assert.deepEqual([year.actualMonths, year.partialMonths, year.forecastMonths], [0, 1, 0]);
  });

  test('sales loaded ahead of the retrain count instead of that month\'s forecast', () => {
    const rows = [row(1, '2026-09-01', { forecast_current: 300 })];
    const [year] = buildYearlyTotals(rows, [actual(1, '2026-09-01', 250)]);

    assert.deepEqual(year.volume, { actual: 250, forecast: null, total: 250 });
  });

  test('a reported customer x SKU with no sales row is a real 0', () => {
    const [year] = buildYearlyTotals([row(1, '2026-07-01', { actual_status: 'reported' })], []);

    assert.deepEqual(year.volume, { actual: 0, forecast: null, total: 0 });
    assert.equal(year.actualMonths, 1);
  });

  test('a missing file adds nothing and is not called a month of actuals', () => {
    const years = buildYearlyTotals([row(1, '2026-06-01', { actual_status: 'missing_file' })], []);

    assert.deepEqual(years, []);
  });

  test('each year gets its own card', () => {
    const rows = [
      row(1, '2026-12-01', { forecast_current: 100 }),
      row(1, '2027-01-01', { forecast_current: 110 }),
    ];
    const years = buildYearlyTotals(rows, []);

    assert.deepEqual(years.map((year) => [year.year, year.volume.total]), [['2026', 100], ['2027', 110]]);
  });
});
