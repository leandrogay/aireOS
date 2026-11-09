import test from 'node:test';
import assert from 'node:assert/strict';

import { breakdownForRow, discountSourceLabel } from '../app/utils/scenarioBreakdown.js';

test('breakdown keeps Tier 0 provenance and adds scenario contributions', () => {
  const result = breakdownForRow(
    {
      forecast_current: 540,
      tier0_sell_out_base: 540,
      tier0_ly_cartons: 480,
      tier0_run_rate: 600,
      tier0_base_method: 'ly+runrate',
    },
    { blocks: 30, promotions: -12 }
  );

  assert.deepEqual(result.baseline, { lastYear: 480, growth: 60, model: 540 });
  assert.deepEqual(result.scenario, { blocks: 30, promotions: -12 });
  assert.equal(result.simulated, 558);
  assert.equal(result.tier0.runRate, 600);
});

test('discount source labels distinguish frozen and fallback states', () => {
  assert.equal(discountSourceLabel('measured'), 'Measured');
  assert.equal(discountSourceLabel('anchor'), 'Anchor fallback');
  assert.equal(discountSourceLabel('not_frozen_yet'), 'Not frozen yet');
});
