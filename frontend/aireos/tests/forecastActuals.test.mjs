// Missing, partial and real-0 actuals, and how much of a selection a line
// covers (app/utils/forecastActuals.js). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  actualKind,
  dataMonthEntries,
  dataMonthsByMonth,
  initialVsActual,
  lineCoverage,
  monthNotes,
  monthlyActuals,
  withActualBridges,
} from '../app/utils/forecastActuals.js';

const CUSTOMERS = { fairprice: 1, nhg: 2, singhealth: 3 };

// One tier's forecast row (Tier 0 unless overridden).
function row(customer, sku, month, status, extra = {}) {
  return {
    customer_id: CUSTOMERS[customer],
    customer_name: customer,
    sku,
    product_name: `Pants ${sku}`,
    month_year: month,
    tier: 'tier0',
    actual_status: status,
    forecast_current: status === 'not_yet' ? 100 : null,
    forecast_previous: null,
    forecast_initial: null,
    ...extra,
  };
}

// One monthly sales row (GET /api/forecast actuals).
function sale(customer, sku, month, cartons) {
  return {
    customer_id: CUSTOMERS[customer],
    customer_name: customer,
    sku,
    product_name: `Pants ${sku}`,
    month_year: month,
    quantity_cartons: cartons,
  };
}

const format = { formatCustomer: (name) => name.toUpperCase(), formatStamp: (stamp) => stamp };

// ---- Missing files ----------------------------------------------------------

describe('a missing sales file', () => {
  test('NHG January 2026 is missing for every NHG SKU: no actual, never 0', () => {
    const rows = [
      row('nhg', 'L', '2025-12-01', 'reported'),
      row('nhg', 'XL', '2025-12-01', 'reported'),
      row('nhg', 'L', '2026-01-01', 'missing_file'),
      row('nhg', 'XL', '2026-01-01', 'missing_file'),
      row('nhg', 'L', '2026-02-01', 'reported'),
      row('nhg', 'XL', '2026-02-01', 'reported'),
    ];
    const actuals = [
      sale('nhg', 'L', '2025-12-01', 40),
      sale('nhg', 'XL', '2025-12-01', 20),
      sale('nhg', 'L', '2026-02-01', 44),
      sale('nhg', 'XL', '2026-02-01', 21),
    ];

    const january = monthlyActuals(rows, actuals).get('2026-01-01');

    assert.equal(january.value, null);
    assert.equal(january.kind, 'missing');
    assert.deepEqual(monthNotes({ month_year: '2026-01-01', actualKind: 'missing', actualCoverage: january.coverage }, format), [
      { label: 'Actual', value: 'missing (no sales file for this month)' },
    ]);
  });

  test('SingHealth May 2026 is missing: the months either side keep their actuals', () => {
    const rows = ['2026-04-01', '2026-05-01', '2026-06-01'].map((month) =>
      row('singhealth', 'L', month, month === '2026-05-01' ? 'missing_file' : 'reported')
    );
    const actuals = [sale('singhealth', 'L', '2026-04-01', 12), sale('singhealth', 'L', '2026-06-01', 15)];

    const months = monthlyActuals(rows, actuals);

    assert.equal(months.get('2026-04-01').value, 12);
    assert.equal(months.get('2026-05-01').value, null);
    assert.equal(months.get('2026-05-01').kind, 'missing');
    assert.equal(months.get('2026-06-01').value, 15);
  });

  test('All customers in January 2026 is partial: the sum of those that reported, NHG named', () => {
    const rows = [
      row('fairprice', 'L', '2026-01-01', 'reported'),
      row('nhg', 'L', '2026-01-01', 'missing_file'),
      row('singhealth', 'L', '2026-01-01', 'reported'),
    ];
    const actuals = [sale('fairprice', 'L', '2026-01-01', 300), sale('singhealth', 'L', '2026-01-01', 25)];

    const january = monthlyActuals(rows, actuals).get('2026-01-01');

    assert.equal(january.value, 325);
    assert.equal(january.kind, 'partial');
    const notes = monthNotes(
      { month_year: '2026-01-01', actualKind: january.kind, actualCoverage: january.coverage },
      format
    );
    assert.deepEqual(notes, [{ label: 'Actual', value: 'partial — missing for NHG (no sales file)' }]);
  });
});

// ---- Real zeros ---------------------------------------------------------------

describe('a reported month', () => {
  test('a SKU that sold nothing in a month its customer sent still shows 0', () => {
    // No sales row for XL in March: the customer sent March, so XL sold 0.
    const rows = [row('fairprice', 'XL', '2026-03-01', 'reported')];

    const march = monthlyActuals(rows, []).get('2026-03-01');

    assert.equal(march.value, 0);
    assert.equal(march.kind, 'full');
  });

  test('a reported 0 next to other SKUs adds nothing and is not partial', () => {
    const rows = [row('fairprice', 'L', '2026-03-01', 'reported'), row('fairprice', 'XL', '2026-03-01', 'reported')];
    const march = monthlyActuals(rows, [sale('fairprice', 'L', '2026-03-01', 80)]).get('2026-03-01');

    assert.equal(march.value, 80);
    assert.equal(march.kind, 'full');
  });

  test('not yet and before the first sale say nothing and stay blank', () => {
    const rows = [row('fairprice', 'L', '2026-12-01', 'before_first_sale', { forecast_current: null })];
    const december = monthlyActuals(rows, []).get('2026-12-01');

    assert.equal(december.value, null);
    assert.equal(december.kind, null);
  });

  test('history before the forecast window keeps its actuals with no status', () => {
    const months = monthlyActuals([], [sale('fairprice', 'L', '2024-05-01', 70)]);

    assert.deepEqual(months.get('2024-05-01'), { value: 70, kind: null, coverage: null });
  });
});

// ---- A lagging customer ---------------------------------------------------------

describe('customers whose latest month differs', () => {
  test('a lagging customer is still forecast where another has an actual; the two are never added', () => {
    // FairPrice sent August; NHG's latest is July, so its Current starts in August.
    const rows = [
      row('fairprice', 'L', '2026-08-01', 'reported'),
      row('fairprice', 'XL', '2026-08-01', 'reported'),
      row('fairprice', 'M', '2026-08-01', 'reported'),
      row('nhg', 'L', '2026-08-01', 'not_yet', { forecast_current: 50 }),
      row('nhg', 'XL', '2026-08-01', 'not_yet', { forecast_current: 30 }),
    ];
    const actuals = [
      sale('fairprice', 'L', '2026-08-01', 100),
      sale('fairprice', 'XL', '2026-08-01', 60),
      sale('fairprice', 'M', '2026-08-01', 40),
    ];

    const august = monthlyActuals(rows, actuals).get('2026-08-01');

    // The actual is FairPrice's 200 only, not 200 + NHG's 80 forecast.
    assert.equal(august.value, 200);
    assert.equal(august.kind, 'partial');
    assert.deepEqual(
      monthNotes({ month_year: '2026-08-01', actualKind: august.kind, actualCoverage: august.coverage }, format),
      [{ label: 'Actual', value: 'Actuals for 3 of 5 SKUs; 2 still forecast for Aug' }]
    );
  });

  test('kind is null when nothing in scope has reported or gone missing', () => {
    assert.equal(actualKind({ reported: [], missing: [], waiting: [{}] }), null);
  });
});

// ---- The Actual line across a gap ----------------------------------------------

describe('joining the Actual line', () => {
  test('each gap gets its own dashed join between the actuals either side', () => {
    const points = [
      { month_year: '2025-12-01', actual: 60 },
      { month_year: '2026-01-01', actual: null },
      { month_year: '2026-02-01', actual: 65 },
      { month_year: '2026-03-01', actual: 70 },
      { month_year: '2026-04-01', actual: null },
      { month_year: '2026-05-01', actual: null },
      { month_year: '2026-06-01', actual: 75 },
      { month_year: '2026-07-01', actual: null },
    ];

    const { points: bridged, keys } = withActualBridges(points);

    assert.deepEqual(keys, ['actualBridge0', 'actualBridge1']);
    assert.deepEqual(
      bridged.map((point) => point.actualBridge0 ?? null),
      [60, null, 65, null, null, null, null, null]
    );
    assert.deepEqual(
      bridged.map((point) => point.actualBridge1 ?? null),
      [null, null, null, 70, null, null, 75, null]
    );
    // The missing months themselves stay empty: no point, never 0.
    assert.equal(bridged[1].actual, null);
  });

  test('no gap, no join; nothing after the latest actual is joined', () => {
    const { keys } = withActualBridges([{ actual: 1 }, { actual: 2 }, { actual: null }]);
    assert.deepEqual(keys, []);
  });
});

// ---- Initial and Previous per SKU and tier --------------------------------------

describe('line coverage', () => {
  test('a SKU with a Tier 1 Previous NULL leaves the line on the other SKU only', () => {
    const tier1 = [
      row('fairprice', 'L', '2026-09-01', 'not_yet', { tier: 'tier1_basic', forecast_previous: 90 }),
      row('fairprice', 'XL', '2026-09-01', 'not_yet', { tier: 'tier1_basic', forecast_previous: null }),
    ];

    assert.deepEqual(lineCoverage(tier1, 'forecast_previous'), { withLine: 1, total: 2 });
  });

  test('a Tier 0 SKU launched after the plan has no Initial at all', () => {
    const rows = [row('fairprice', 'NEW', '2026-09-01', 'not_yet'), row('fairprice', 'NEW', '2026-10-01', 'not_yet')];

    assert.deepEqual(lineCoverage(rows, 'forecast_initial'), { withLine: 0, total: 1 });
  });

  test('the same SKU at two customers counts twice', () => {
    const rows = [
      row('fairprice', 'L', '2026-09-01', 'not_yet', { forecast_initial: 10 }),
      row('nhg', 'L', '2026-09-01', 'not_yet'),
    ];

    assert.deepEqual(lineCoverage(rows, 'forecast_initial'), { withLine: 1, total: 2 });
  });
});

describe('what Current and Previous were made with', () => {
  // FairPrice is on October, NHG on September; Previous is one month less.
  const months = (customer) =>
    customer === 'fairprice'
      ? { current_data_month: '2026-10-01', previous_data_month: '2026-09-01' }
      : { current_data_month: '2026-09-01', previous_data_month: '2026-08-01' };
  const forecastRow = (customer, sku, month, extra = {}) =>
    row(customer, sku, month, 'not_yet', { forecast_previous: 90, ...months(customer), ...extra });

  test('the hover card reads the data month, never previous_generated_at', () => {
    const rows = [
      forecastRow('fairprice', 'L', '2026-11-01', { previous_generated_at: '2026-11-12T03:14:59Z' }),
      forecastRow('fairprice', 'XL', '2026-11-01'),
    ];
    const point = {
      month_year: '2026-11-01',
      current: 200,
      previous: 180,
      currentData: dataMonthsByMonth(rows, 'current').get('2026-11-01'),
      previousData: dataMonthsByMonth(rows, 'previous').get('2026-11-01'),
    };

    assert.deepEqual(monthNotes(point, format), [
      { label: 'Current forecast', value: 'Made with sales up to Oct 2026' },
      { label: 'Previous forecast', value: 'Made with sales up to Sep 2026' },
    ]);
  });

  test('mixed customers get a row each', () => {
    const rows = [forecastRow('fairprice', 'L', '2026-11-01'), forecastRow('nhg', 'L', '2026-11-01')];
    const point = { month_year: '2026-11-01', previous: 180, previousData: dataMonthsByMonth(rows, 'previous').get('2026-11-01') };

    assert.deepEqual(monthNotes(point, { ...format, showCurrent: false }), [
      { label: 'Previous forecast', value: 'FAIRPRICE: sales up to Sep 2026' },
      { label: 'Previous forecast', value: 'NHG: sales up to Aug 2026' },
    ]);
  });

  test('a series with no Previous adds no Previous month', () => {
    const rows = [
      forecastRow('fairprice', 'L', '2026-11-01'),
      forecastRow('fairprice', 'NEW', '2026-11-01', { forecast_previous: null, previous_data_month: null }),
    ];

    assert.deepEqual(dataMonthEntries(rows, 'previous'), [
      { productName: 'Pants L', customerName: 'fairprice', month: '2026-09-01' },
    ]);
    assert.equal(dataMonthEntries(rows, 'current').length, 2);
  });

  test('each customer x SKU counts once across its months', () => {
    const rows = [forecastRow('fairprice', 'L', '2026-11-01'), forecastRow('fairprice', 'L', '2026-12-01')];

    assert.equal(dataMonthEntries(rows, 'previous').length, 1);
  });

  test('a line\'s month is left out while that line is off', () => {
    const entries = [{ productName: 'Pants L', customerName: 'fairprice', month: '2026-09-01' }];
    const point = { month_year: '2026-11-01', current: 9, previous: 9, currentData: entries, previousData: entries };

    assert.deepEqual(monthNotes(point, { ...format, showCurrent: false, showPrevious: false }), []);
  });
});

// ---- Initial vs actual ------------------------------------------------------

// A month point as buildMonthlyPoints makes it, `reported` series reporting.
function point({ actual, initial, kind = 'full', reported = 1, initialSeries = reported }) {
  return {
    actual,
    initial,
    initialSeries,
    actualKind: kind,
    actualCoverage: { reported: Array.from({ length: reported }, (_, i) => ({ key: `1|S${i}` })), missing: [], waiting: [] },
  };
}

describe('initial vs actual', () => {
  test('a fully reported month gives the gap as cartons and a % of the actual', () => {
    assert.deepEqual(initialVsActual(point({ actual: 200, initial: 216 })), { diff: 16, pct: 8 });
  });

  test('an actual of 0 gives the gap with no percentage', () => {
    assert.deepEqual(initialVsActual(point({ actual: 0, initial: 50 })), { diff: 50, pct: null });
  });

  test('a partial month is not compared', () => {
    assert.equal(initialVsActual(point({ actual: 200, initial: 216, kind: 'partial' })), null);
  });

  test('a month where some SKUs have no Initial is not compared', () => {
    assert.equal(initialVsActual(point({ actual: 200, initial: 216, reported: 3, initialSeries: 2 })), null);
  });

  test('a month with no Initial is not compared', () => {
    assert.equal(initialVsActual(point({ actual: 200, initial: null, initialSeries: 0 })), null);
  });
});
