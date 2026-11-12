import test from 'node:test';
import assert from 'node:assert/strict';

import {
  liveReferences,
  liveUplift,
  liveUpliftIndex,
  liveUpliftValues,
  weakestLevel,
} from '../app/utils/scenarioLiveUplifts.js';

const TWENTY = { version_id: 1, mechanic_label: '20% Off', anchor_pct: 20, effective_from: null };
const FIFTEEN = { version_id: 2, mechanic_label: '15% Off', anchor_pct: 15, effective_from: '2027-06-01' };

function sku(product, upliftPct, level = 'placeholder') {
  return { sku: product.toLowerCase(), product_name: product, level, uplift_pct: upliftPct };
}

// FairPrice Pants on 30% Off: +4% against 20% Off now, +6% against 15% Off from Jun 2027.
const ROWS = [
  {
    customer_name: 'FairPrice',
    sku_range: 'Pants',
    mechanic_key: 'pct_off_30',
    versions: [
      { effective_from: '2026-11-01', anchor: TWENTY, skus: [sku('Pants M', 4), sku('Pants L', 9, 'measured')] },
      { effective_from: '2027-06-01', anchor: FIFTEEN, skus: [sku('Pants M', 6), sku('Pants L', null, 'unavailable')] },
    ],
  },
  {
    customer_name: 'FairPrice',
    sku_range: 'Tape',
    mechanic_key: 'pct_off_30',
    versions: [{ effective_from: '2026-11-01', anchor: TWENTY, skus: [sku('Tape S', 4)] }],
  },
];

const INDEX = liveUpliftIndex(ROWS);

function promotion(changes = {}) {
  return {
    customer: 'FairPrice',
    mechanicKey: 'pct_off_30',
    skuRanges: ['Pants'],
    sku: '',
    startMonth: '2027-01-01',
    endMonth: '2027-01-01',
    ...changes,
  };
}

// ---- one product, one month ------------------------------------------------------

test('a month takes the anchor version in effect then', () => {
  const where = { customer: 'FairPrice', mechanicKey: 'pct_off_30', product: 'Pants M' };

  assert.equal(liveUplift(INDEX, { ...where, month: '2027-05-01' }).upliftPct, 4);
  assert.equal(liveUplift(INDEX, { ...where, month: '2027-06-01' }).upliftPct, 6);
  assert.equal(liveUplift(INDEX, { ...where, month: '2027-06-01' }).anchor.mechanic_label, '15% Off');
});

test('a month before the first version takes the first', () => {
  const live = liveUplift(INDEX, { customer: 'FairPrice', mechanicKey: 'pct_off_30', product: 'Pants M', month: '2026-01-01' });

  assert.equal(live.upliftPct, 4);
});

test('an unavailable value, or one with no row, is null so the saved value is used', () => {
  const where = { customer: 'FairPrice', mechanicKey: 'pct_off_30', month: '2027-06-01' };

  assert.equal(liveUplift(INDEX, { ...where, product: 'Pants L' }), null);
  assert.equal(liveUplift(INDEX, { ...where, product: 'Not a product' }), null);
  assert.equal(liveUplift(INDEX, { ...where, customer: 'NHG', product: 'Pants M' }), null);
});

// ---- a whole promotion -----------------------------------------------------------

test('a promotion takes every SKU of its ranges in the versions its months reach', () => {
  const january = liveUpliftValues(INDEX, promotion());
  const spanning = liveUpliftValues(INDEX, promotion({ endMonth: '2027-07-01' }));

  assert.deepEqual(january.map((item) => [item.product, item.upliftPct]), [['Pants M', 4], ['Pants L', 9]]);
  assert.deepEqual(spanning.map((item) => [item.product, item.upliftPct]), [['Pants M', 4], ['Pants L', 9], ['Pants M', 6]]);
});

test('All SKU ranges covers every range of the customer', () => {
  const products = liveUpliftValues(INDEX, promotion({ skuRanges: [] })).map((item) => item.product);

  assert.deepEqual(products, ['Pants M', 'Pants L', 'Tape S']);
});

test('the weakest level wins, so a summary never reads better than its weakest value', () => {
  assert.equal(weakestLevel([{ level: 'measured' }, { level: 'placeholder' }]), 'placeholder');
  assert.equal(weakestLevel([{ level: 'anchor' }, { level: 'measured_earlier' }]), 'measured_earlier');
  assert.equal(weakestLevel([]), null);
});

test('saving records the first month: the common value, products that differ, the weakest level', () => {
  assert.deepEqual(liveReferences(INDEX, promotion({ skuRanges: [] })), {
    referenceUpliftPct: 4,
    referenceSource: 'placeholder',
    referenceBySku: { 'Pants L': 9 },
  });
  assert.equal(liveReferences(INDEX, promotion({ customer: 'NHG' })), null);
});
