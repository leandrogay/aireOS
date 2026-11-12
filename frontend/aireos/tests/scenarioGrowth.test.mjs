import test from 'node:test';
import assert from 'node:assert/strict';

import { findGrowth, growthFields, growthInYears, growthYears, isGrowthBlock } from '../app/utils/scenarioGrowth.js';

function growth(customer, year, upliftValue = 8) {
  return { id: `${customer}-${year}`, ...growthFields(customer, year), upliftValue };
}

test('a growth covers every SKU of one customer from january to december as a %', () => {
  assert.deepEqual(growthFields('fairprice', '2027'), {
    kind: 'growth',
    customers: ['fairprice'],
    skuRanges: [],
    sku: '',
    name: 'Growth 2027',
    upliftMode: 'pct',
    startMonth: '2027-01-01',
    endMonth: '2027-12-01',
  });
});

test('only blocks of kind growth are growth', () => {
  assert.equal(isGrowthBlock(growth('fairprice', '2027')), true);
  assert.equal(isGrowthBlock({ kind: 'block' }), false);
  assert.equal(isGrowthBlock({}), false);
});

test('growth years are the years of the forecast months in view, once each', () => {
  assert.deepEqual(growthYears(['2027-02-01', '2026-12-01', '2027-01-01']), ['2026', '2027']);
});

test('a customer growth is found by its year', () => {
  const blocks = [growth('fairprice', '2027'), growth('fairprice', '2028'), growth('sheng_siong', '2027')];

  assert.equal(findGrowth(blocks, 'fairprice', '2028').id, 'fairprice-2028');
  assert.equal(findGrowth(blocks, 'nhg', '2027'), null);
});

test('all customers lists every growth in the years in view by customer, then year', () => {
  const blocks = [
    growth('sheng_siong', '2027'),
    growth('fairprice', '2028'),
    growth('fairprice', '2027'),
    growth('fairprice', '2029'),
  ];

  const shown = growthInYears(blocks, ['2027', '2028']).map((block) => block.id);

  assert.deepEqual(shown, ['fairprice-2027', 'fairprice-2028', 'sheng_siong-2027']);
});
