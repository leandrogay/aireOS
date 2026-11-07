// Actual vs forecast over months picked on the sell-in plan chart. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { monthsWithoutActuals, rangeComparison } from '../app/utils/sellInComparison.js';

function compared(actual, forecast, source = 'initial', skusCompared = 2, skusWithActuals = 2) {
  return {
    actual,
    forecast,
    forecast_source: source,
    skus_compared: skusCompared,
    skus_with_actuals: skusWithActuals,
  };
}

function month(iso, { sellIn = null, sellOut = null, actual = 1 } = {}) {
  return {
    month: iso,
    sell_in_actual: actual,
    sell_out_actual: actual,
    sell_in_vs_forecast: sellIn,
    sell_out_vs_forecast: sellOut,
  };
}

describe('rangeComparison', () => {
  test('adds the months up and works out the difference', () => {
    const months = [
      month('2026-06-01', { sellOut: compared(100, 80) }),
      month('2026-07-01', { sellOut: compared(120, 120) }),
    ];

    const result = rangeComparison(months, 'sell_out_vs_forecast');

    assert.equal(result.actual, 220);
    assert.equal(result.forecast, 200);
    assert.equal(result.difference, 20);
    assert.equal(result.percent, 10);
    assert.equal(result.source, 'initial');
    assert.equal(result.someSkusMissing, false);
  });

  test('months on different forecasts read as mixed', () => {
    const months = [
      month('2026-06-01', { sellIn: compared(10, 10, 'initial') }),
      month('2026-07-01', { sellIn: compared(10, 10, 'previous') }),
    ];

    assert.equal(rangeComparison(months, 'sell_in_vs_forecast').source, 'mixed');
  });

  test('flags a month that left SKUs out', () => {
    const months = [month('2026-07-01', { sellIn: compared(10, 10, 'initial', 6, 9) })];

    assert.equal(rangeComparison(months, 'sell_in_vs_forecast').someSkusMissing, true);
  });

  test('months that could not be compared are skipped', () => {
    const months = [month('2026-06-01'), month('2026-07-01', { sellOut: compared(50, 40) })];

    assert.equal(rangeComparison(months, 'sell_out_vs_forecast').actual, 50);
  });

  test('nothing to compare gives null', () => {
    assert.equal(rangeComparison([month('2026-06-01')], 'sell_in_vs_forecast'), null);
  });

  test('a zero forecast has no percentage', () => {
    const months = [month('2026-07-01', { sellIn: compared(10, 0) })];

    assert.equal(rangeComparison(months, 'sell_in_vs_forecast').percent, null);
  });
});

describe('monthsWithoutActuals', () => {
  test('lists only the months with no actuals at all', () => {
    const months = [month('2026-07-01'), month('2026-08-01', { actual: null }), month('2026-09-01', { actual: null })];

    assert.deepEqual(monthsWithoutActuals(months), ['2026-08-01', '2026-09-01']);
  });
});
