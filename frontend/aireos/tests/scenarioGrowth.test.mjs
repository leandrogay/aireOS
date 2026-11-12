import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findGrowth,
  growthFields,
  growthInYears,
  growthRanges,
  growthYears,
  isGrowthBlock,
  skusWithoutRange,
} from '../app/utils/scenarioGrowth.js';

function growth(customer, skuRange, year, upliftValue = 8) {
  return { id: `${customer}-${skuRange}-${year}`, ...growthFields(customer, skuRange, year), upliftValue };
}

function row(customer, product, skuRange) {
  return { customer_name: customer, product_name: product, sku_range: skuRange };
}

test('a growth covers one SKU range of one customer from january to december as a %', () => {
  assert.deepEqual(growthFields('fairprice', 'Ultra Tape', '2027'), {
    kind: 'growth',
    customers: ['fairprice'],
    skuRanges: ['Ultra Tape'],
    sku: '',
    name: 'Growth 2027 · Ultra Tape',
    upliftMode: 'pct',
    startMonth: '2027-01-01',
    endMonth: '2027-12-01',
  });
});

test('only blocks of kind growth are growth', () => {
  assert.equal(isGrowthBlock(growth('fairprice', 'Ultra Tape', '2027')), true);
  assert.equal(isGrowthBlock({ kind: 'block' }), false);
  assert.equal(isGrowthBlock({}), false);
});

test('growth years are the years of the forecast months in view, once each', () => {
  assert.deepEqual(growthYears(['2027-02-01', '2026-12-01', '2027-01-01']), ['2026', '2027']);
});

test('growth ranges are the customer ranges in view, once each, in order', () => {
  const rows = [
    row('fairprice', 'Ultra Tape L', 'Ultra Tape'),
    row('fairprice', 'Ultra Tape M', 'Ultra Tape'),
    row('fairprice', 'Comfort Pants M', 'Comfort Pants'),
    row('fairprice', 'Loose Wipes', null),
    row('sheng_siong', 'Night Pants', 'Night Pants'),
  ];

  assert.deepEqual(growthRanges(rows, 'fairprice'), ['Comfort Pants', 'Ultra Tape']);
  assert.equal(skusWithoutRange(rows, 'fairprice'), 1);
});

test('a customer growth is found by its range and year', () => {
  const blocks = [
    growth('fairprice', 'Ultra Tape', '2027'),
    growth('fairprice', 'Comfort Pants', '2027'),
    growth('fairprice', 'Ultra Tape', '2028'),
  ];

  assert.equal(findGrowth(blocks, 'fairprice', 'Comfort Pants', '2027').id, 'fairprice-Comfort Pants-2027');
  assert.equal(findGrowth(blocks, 'fairprice', 'Night Pants', '2027'), null);
});

test('all customers lists every growth in the years in view by customer, range, then year', () => {
  const blocks = [
    growth('sheng_siong', 'Ultra Tape', '2027'),
    growth('fairprice', 'Ultra Tape', '2028'),
    growth('fairprice', 'Ultra Tape', '2027'),
    growth('fairprice', 'Comfort Pants', '2027'),
    growth('fairprice', 'Ultra Tape', '2029'),
  ];

  const shown = growthInYears(blocks, ['2027', '2028']).map((block) => block.id);

  assert.deepEqual(shown, [
    'fairprice-Comfort Pants-2027',
    'fairprice-Ultra Tape-2027',
    'fairprice-Ultra Tape-2028',
    'sheng_siong-Ultra Tape-2027',
  ]);
});
