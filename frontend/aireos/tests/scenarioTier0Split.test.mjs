import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICIAL_ITEM,
  bigChange,
  monthSplit,
  officialCells,
  promotionCells,
  splitForRow,
  tier0SplitIndex,
} from '../app/utils/scenarioTier0Split.js';

const MONTH = '2027-06-01';

function row(sku, current) {
  return { customer_id: 1, customer_name: 'FairPrice', sku, product_name: `Product ${sku}`, sku_range: 'Pants', month_year: MONTH, forecast_current: current };
}

function split(sku, { tier0 = 110, baseline = 100, carried = 10, official = null, lastYear = '30% Off' } = {}) {
  return {
    customer_id: 1,
    sku,
    month_year: MONTH,
    tier0,
    run_rate: 110,
    baseline,
    carried,
    carried_level: 'measured',
    last_year: { month: '2026-06-01', units: 110, promotions: [{ mechanic: lastYear, level: 'measured' }] },
    recent: [{ month: '2027-03-01', units: 110, promotions: [{ mechanic: '30% Off', level: 'measured' }] }],
    official: official ?? { planned: false, uplift_pct: 0, promotions: [], level: null, missing: [] },
  };
}

const promotion = { id: 'p1', customer: 'FairPrice', startMonth: MONTH, endMonth: MONTH };

// ---- which split a row takes -------------------------------------------------------

test('a split is used only when it adds up to the row\'s Tier 0', () => {
  const index = tier0SplitIndex({ rows: [split('A'), split('B', { tier0: 140 })] });

  assert.equal(splitForRow(index, row('A', 110)).baseline, 100);
  assert.equal(splitForRow(index, row('B', 110)), null);
  assert.equal(splitForRow(index, row('C', 110)), null);
});

// ---- official promotions ------------------------------------------------------------

test('an official promotion puts the baseline with its uplift in place of what Tier 0 carries', () => {
  const index = tier0SplitIndex({
    rows: [split('A', { official: { planned: true, uplift_pct: 5, promotions: [{ mechanic: '25% Off' }] } })],
  });

  const [cell] = officialCells([row('A', 110)], index, OFFICIAL_ITEM);

  assert.equal(cell.addedUnits, 5);
  assert.equal(cell.replacedUnits, 10);
  assert.equal(cell.deltaUnits, -5);
});

test('a month with nothing official planned has no official cell', () => {
  assert.deepEqual(officialCells([row('A', 110)], tier0SplitIndex({ rows: [split('A')] }), OFFICIAL_ITEM), []);
});

// ---- scenario promotions -------------------------------------------------------------

function cells(index, promotions, uplift = 20, share = 1) {
  return promotionCells(promotions, index, () => [row('A', 110)], () => uplift * share, () => share);
}

test('a scenario promotion replaces what Tier 0 carries where nothing official is planned', () => {
  const [cell] = cells(tier0SplitIndex({ rows: [split('A')] }), [promotion]);

  assert.equal(cell.addedUnits, 20);
  assert.equal(cell.replacedUnits, 10);
  assert.equal(110 + cell.deltaUnits, 120);
});

test('a scenario promotion is added on top of an official one', () => {
  const index = tier0SplitIndex({ rows: [split('A', { official: { planned: true, uplift_pct: 5, promotions: [] } })] });

  const [cell] = cells(index, [promotion]);

  assert.equal(cell.replacedUnits, 0);
  assert.equal(cell.addedUnits, 20);
});

test('a promotion for half the month replaces half of what is carried', () => {
  const [cell] = cells(tier0SplitIndex({ rows: [split('A')] }), [promotion], 20, 0.5);

  assert.equal(cell.replacedUnits, 5);
});

test('two promotions over the whole month replace the carried block once between them', () => {
  const second = { ...promotion, id: 'p2' };

  const result = cells(tier0SplitIndex({ rows: [split('A')] }), [promotion, second], 20, 0.75);

  assert.equal(result.reduce((sum, cell) => sum + cell.replacedUnits, 0), 10);
});

test('with no split a scenario promotion works on Tier 0 as before', () => {
  const [cell] = cells(null, [promotion]);

  assert.equal(cell.addedUnits, 22);
  assert.equal(cell.replacedUnits, 0);
});

// ---- one month for the Breakdown tab ----------------------------------------------------

test('a month adds up its rows and names the promotions behind each source month', () => {
  const index = tier0SplitIndex({
    rows: [split('A'), split('B', { lastYear: 'Buy 2 Get 1 Free', official: { planned: true, uplift_pct: 5, promotions: [{ mechanic: '25% Off' }], level: 'placeholder' } })],
  });

  const month = monthSplit([row('A', 110), row('B', 110), row('C', 50)], index, MONTH);

  assert.deepEqual([month.tier0, month.runRate, month.baseline, month.carried], [270, 220, 250, 20]);
  assert.deepEqual([month.splitRows, month.unsplitRows], [2, 1]);
  assert.deepEqual(month.lastYear.mechanics, ['30% Off', 'Buy 2 Get 1 Free']);
  assert.deepEqual(month.official.mechanics, ['25% Off']);
  assert.equal(month.official.level, 'placeholder');
  assert.equal(month.notPlannedRows, 1);
});

test('a change of more than 35% of Tier 0 is flagged', () => {
  assert.equal(bigChange(100, 30), null);
  assert.deepEqual(bigChange(100, 200), { ratio: 3, change: 200 });
  assert.deepEqual(bigChange(100, -40), { ratio: 0.6, change: -40 });
});
