import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanRows } from '../app/utils/scenarioPlan.js';

const MONTH = '2027-06-01';

test('a plan row carries what Simulated is made of, part by part', () => {
  const breakdown = { baseline: 100, carried: 10, officialAdded: 0, growth: 6, blocks: 0, promotionsAdded: 9, promotions: 9 };

  const [row] = buildPlanRows({
    rows: [{ month_year: MONTH, forecast_current: 110 }],
    lastYearActuals: [],
    byMonth: new Map([[MONTH, { deltaUnits: 15 }]]),
    monthItems: new Map(),
    breakdowns: new Map([[MONTH, breakdown]]),
  });

  assert.deepEqual(row.parts, { baseline: 100, carried: 10, official: 0, growth: 6, blocks: 0, promotions: 9 });
  assert.equal(row.adjusted.units, 125);
});

test('a month with no breakdown has no parts', () => {
  const [row] = buildPlanRows({
    rows: [{ month_year: MONTH, forecast_current: 110 }],
    lastYearActuals: [],
    byMonth: new Map(),
    monthItems: new Map(),
  });

  assert.equal(row.parts, null);
});

// ---- the Promotions column ---------------------------------------------------------

const SPLIT = {
  splitRows: 2,
  notPlannedRows: 1,
  official: { plannedRows: 1, mechanics: ['25% Off'] },
  carriedPromotions: {
    all: [{ kind: 'lastYear', months: ['2026-06-01'], mechanics: ['30% Off', 'Buy 2 Get 1 Free'] }],
    unplanned: [{ kind: 'lastYear', months: ['2026-06-01'], mechanics: ['30% Off'] }],
  },
};

function planRow(included, breakdown = { baseline: 200, carried: 10, officialAdded: 5, growth: 0, blocks: 0, promotionsAdded: 0 }) {
  const [row] = buildPlanRows({
    rows: [{ month_year: MONTH, forecast_current: 220 }],
    lastYearActuals: [],
    byMonth: new Map(),
    monthItems: new Map(),
    breakdowns: new Map([[MONTH, breakdown]]),
    splits: new Map([[MONTH, SPLIT]]),
    included,
  });
  return row;
}

test('a partly planned month lists last year\'s promotions still carried and the planned ones', () => {
  const row = planRow({ carried: true, official: true });

  assert.deepEqual(row.promotionLines, [
    { kind: 'carried', units: 10, sources: SPLIT.carriedPromotions.unplanned },
    { kind: 'official', units: 5, mechanics: ['25% Off'] },
  ]);
  assert.equal(row.planStatus, 'partly');
});

test('with official promotions left out, last year\'s are listed for every SKU', () => {
  const row = planRow({ carried: true, official: false }, { baseline: 200, carried: 20, officialAdded: 0, growth: 0, blocks: 0 });

  assert.deepEqual(row.promotionLines, [{ kind: 'carried', units: 20, sources: SPLIT.carriedPromotions.all }]);
});

test('last year\'s promotions left out have no line', () => {
  const row = planRow({ carried: false, official: true }, { baseline: 200, carried: 0, officialAdded: 5, growth: 0, blocks: 0 });

  assert.deepEqual(row.promotionLines.map((line) => line.kind), ['official']);
});
