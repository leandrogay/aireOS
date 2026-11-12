import test from 'node:test';
import assert from 'node:assert/strict';

import { breakdownMonths, sameMonthLastYear, scenarioAdjustments } from '../app/utils/scenarioBreakdown.js';

function row(changes) {
  return {
    month_year: '2027-03-01',
    forecast_current: 540,
    tier0_ly_cartons: 480,
    tier0_run_rate: 600,
    tier0_base_method: 'ly+runrate',
    tier0_recent_months: ['2026-09-01', '2026-10-01', '2026-11-01'],
    ...changes,
  };
}

// ---- Months ------------------------------------------------------------------

test('breakdown months are the forecast months in order, once each', () => {
  const months = breakdownMonths([
    row({ month_year: '2027-02-01' }),
    row({ month_year: '2027-01-01' }),
    row({ month_year: '2027-01-01' }),
    row({ month_year: '2026-12-01', forecast_current: null }),
  ]);

  assert.deepEqual(months, ['2027-01-01', '2027-02-01']);
});

test('same month last year goes back twelve months', () => {
  assert.equal(sameMonthLastYear('2027-01-01'), '2026-01-01');
});

// ---- Scenario adjustments ----------------------------------------------------

test('scenario adjustments are split by source and totalled', () => {
  const result = scenarioAdjustments([
    { source: 'growth', deltaUnits: 43 },
    { source: 'blocks', deltaUnits: 30 },
    { source: 'blocks', deltaUnits: -5 },
    { source: 'promotions', deltaUnits: -12 },
    { source: 'official', deltaUnits: -5 },
  ]);

  assert.deepEqual(result, { official: -5, growth: 43, blocks: 25, promotions: -12, total: 51 });
});

test('a month with nothing simulated adds nothing', () => {
  assert.deepEqual(scenarioAdjustments(), { official: 0, growth: 0, blocks: 0, promotions: 0, total: 0 });
});
