import test from 'node:test';
import assert from 'node:assert/strict';

import {
  breakdownMonths,
  discountSourceLabel,
  sameMonthLastYear,
  scenarioAdjustments,
  tier0Breakdown,
} from '../app/utils/scenarioBreakdown.js';

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

// ---- Tier 0 ------------------------------------------------------------------

test('tier 0 breakdown totals last year and run-rate over every row in view', () => {
  const result = tier0Breakdown([row({}), row({ forecast_current: 100, tier0_ly_cartons: 80, tier0_run_rate: 120 })], '2027-03-01');

  assert.equal(result.tier0, 640);
  assert.equal(result.lastYear, 560);
  assert.equal(result.runRate, 720);
  assert.equal(result.blendedRows, 2);
  assert.equal(result.runRateOnlyRows, 0);
  assert.equal(result.lastYearMonth, '2026-03-01');
});

test('a row with no sales that month last year counts as run-rate only', () => {
  const result = tier0Breakdown(
    [row({}), row({ forecast_current: 120, tier0_ly_cartons: null, tier0_run_rate: 120, tier0_base_method: 'runrate' })],
    '2027-03-01'
  );

  assert.equal(result.lastYear, 480);
  assert.equal(result.runRate, 720);
  assert.equal(result.blendedRows, 1);
  assert.equal(result.runRateOnlyRows, 1);
});

test('without the tier 0 parts only the tier 0 total is known', () => {
  const result = tier0Breakdown(
    [{ month_year: '2027-03-01', forecast_current: 540 }],
    '2027-03-01'
  );

  assert.equal(result.available, false);
  assert.equal(result.tier0, 540);
  assert.equal(result.lastYear, null);
  assert.equal(result.runRate, null);
});

test('other months and rows without a forecast are left out', () => {
  const result = tier0Breakdown(
    [row({}), row({ month_year: '2027-04-01' }), row({ forecast_current: null })],
    '2027-03-01'
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.tier0, 540);
});

test('the run-rate window joins every series months in order', () => {
  const result = tier0Breakdown(
    [row({}), row({ tier0_recent_months: ['2026-08-01', '2026-09-01', '2026-10-01'] })],
    '2027-03-01'
  );

  assert.deepEqual(result.recentMonths, ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
});

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
  ]);

  assert.deepEqual(result, { growth: 43, blocks: 25, promotions: -12, total: 56 });
});

test('a month with nothing simulated adds nothing', () => {
  assert.deepEqual(scenarioAdjustments(), { growth: 0, blocks: 0, promotions: 0, total: 0 });
});

test('discount source labels distinguish frozen and fallback states', () => {
  assert.equal(discountSourceLabel('measured'), 'Measured');
  assert.equal(discountSourceLabel('anchor'), 'Anchor fallback');
  assert.equal(discountSourceLabel('not_frozen_yet'), 'Not frozen yet');
});
