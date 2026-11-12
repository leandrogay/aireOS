import test from 'node:test';
import assert from 'node:assert/strict';

import { milestoneBreakdown, milestoneTotals } from '../app/utils/scenarioMilestones.js';

const MARCH = '2026-03-01';
const RANGES = { 'Pants M': 'Pants', 'Tape L': 'Tape' };

function actual(customer, product, units, month = MARCH) {
  return { customer_name: customer, product_name: product, month_year: month, quantity_cartons: units };
}

function block(id, upliftMode, upliftValue, extra = {}) {
  return { id, name: id, kind: 'block', isActive: true, customers: [], skuRanges: [], sku: '', excludedPairs: [],
    upliftMode, upliftValue, startMonth: MARCH, endMonth: MARCH, ...extra };
}

test('a % milestone is worked back from the actual', () => {
  const [[month, value]] = milestoneBreakdown([actual('FairPrice', 'Pants M', 2000)], [block('Flood', 'pct', -20)], RANGES);

  assert.equal(month, MARCH);
  assert.equal(value.actual, 2000);
  assert.equal(Math.round(value.without), 2500);
  assert.deepEqual(value.milestones.map((m) => [m.name, Math.round(m.units)]), [['Flood', -500]]);
});

test('a units milestone counts as entered for each customer, spread by actual', () => {
  const rows = [actual('FairPrice', 'Pants M', 300), actual('FairPrice', 'Tape L', 100), actual('NHG', 'Pants M', 50)];

  const value = milestoneBreakdown(rows, [block('Opening', 'units', 200, { customers: ['FairPrice', 'NHG'] })], RANGES).get(MARCH);

  assert.equal(value.milestones[0].units, 400);
  assert.equal(value.actual, 450);
  assert.equal(value.without, 50);
});

test('a milestone skips other ranges, switched-off pairs, months and switched-off blocks', () => {
  const rows = [actual('FairPrice', 'Pants M', 100), actual('FairPrice', 'Tape L', 100), actual('NHG', 'Pants M', 100)];
  const blocks = [
    block('Pants only', 'pct', 25, { skuRanges: ['Pants'], excludedPairs: [{ customer: 'NHG', skuRange: 'Pants' }] }),
    block('Off', 'pct', 50, { isActive: false }),
    block('Later', 'pct', 50, { startMonth: '2026-04-01', endMonth: '2026-04-01' }),
  ];

  const value = milestoneBreakdown(rows, blocks, RANGES).get(MARCH);

  assert.deepEqual(value.milestones.map((m) => [m.name, m.units]), [['Pants only', 20]]);
  assert.equal(value.without, 280);
});

test('months no milestone touches are left out', () => {
  assert.equal(milestoneBreakdown([actual('FairPrice', 'Pants M', 100)], [], RANGES).size, 0);
});

test('the breakdown adds each milestone up over the months it touches', () => {
  const rows = [actual('FairPrice', 'Pants M', 2000), actual('FairPrice', 'Pants M', 1000, '2026-04-01')];
  const flood = block('Flood', 'pct', -20, { endMonth: '2026-04-01' });

  const totals = milestoneTotals(milestoneBreakdown(rows, [flood], RANGES));

  assert.equal(totals.actual, 3000);
  assert.equal(Math.round(totals.without), 3750);
  assert.deepEqual(totals.milestones.map((m) => [m.name, Math.round(m.units)]), [['Flood', -750]]);
});
