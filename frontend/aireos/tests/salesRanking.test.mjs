// The Dashboard sales ranking's client-side order: which row comes first for
// each sort, ties, and the rank each row gets.
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { customerPalette } from '../app/utils/customerColors.js';
import { compareProductNames, rankCustomers, rankSkus } from '../app/utils/salesRanking.js';

const SKUS = [
  { sku: 'A', product_name: 'Tape M', volume: 10, value: 300 },
  { sku: 'B', product_name: 'Pants L', volume: 30, value: 200 },
  { sku: 'C', product_name: 'Pants XL', volume: 20, value: 200 },
];

describe('rankSkus', () => {
  test('sorts by the metric, highest first, and numbers the rows', () => {
    const ranked = rankSkus(SKUS, 'volume', 'desc');
    assert.deepEqual(ranked.map((row) => [row.sku, row.rank]), [['B', 1], ['C', 2], ['A', 3]]);
  });

  test('asc puts the lowest first and ranks from there', () => {
    const ranked = rankSkus(SKUS, 'volume', 'asc');
    assert.deepEqual(ranked.map((row) => [row.sku, row.rank]), [['A', 1], ['C', 2], ['B', 3]]);
  });

  test('ties go by product name, A to Z, whatever the order', () => {
    assert.deepEqual(rankSkus(SKUS, 'value', 'desc').map((row) => row.sku), ['A', 'B', 'C']);
    assert.deepEqual(rankSkus(SKUS, 'value', 'asc').map((row) => row.sku), ['B', 'C', 'A']);
  });

  test('leaves the rows it was given unchanged', () => {
    const input = SKUS.map((row) => ({ ...row }));
    rankSkus(input, 'volume', 'desc');
    assert.deepEqual(input, SKUS);
  });
});

describe('sorting by product name', () => {
  const PANTS = [
    { sku: '1', product_name: 'Aire Ultra Pants XL', volume: 1, value: 1 },
    { sku: '2', product_name: 'Aire Adult Pants L', volume: 1, value: 1 },
    { sku: '3', product_name: 'Aire Ultra Pants S/M', volume: 1, value: 1 },
    { sku: '4', product_name: 'Aire Adult Pants XXL', volume: 1, value: 1 },
    { sku: '5', product_name: 'Aire Adult Pants S/M', volume: 1, value: 1 },
    { sku: '6', product_name: 'Aire Adult Pants M', volume: 1, value: 1 },
  ];

  test('asc groups each product line, sizes smallest to largest', () => {
    assert.deepEqual(rankSkus(PANTS, 'name', 'asc').map((row) => row.product_name), [
      'Aire Adult Pants S/M',
      'Aire Adult Pants M',
      'Aire Adult Pants L',
      'Aire Adult Pants XXL',
      'Aire Ultra Pants S/M',
      'Aire Ultra Pants XL',
    ]);
  });

  test('desc is the exact reverse', () => {
    const asc = rankSkus(PANTS, 'name', 'asc').map((row) => row.sku);
    assert.deepEqual(rankSkus(PANTS, 'name', 'desc').map((row) => row.sku), [...asc].reverse());
  });

  test('follows the full size scale, XXS to XXL', () => {
    const sizes = ['XXL', 'M/L', 'XS', 'S', 'XL', 'M', 'XXS', 'L', 'S/M'];
    const sorted = sizes.map((size) => `Tape ${size}`).sort(compareProductNames);
    assert.deepEqual(sorted.map((name) => name.slice(5)), ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'XL', 'XXL']);
  });

  test('a name without a known size sorts before the sized ones of its line', () => {
    assert.ok(compareProductNames('Tape', 'Tape S') < 0);
  });
});

describe('rankCustomers', () => {
  const ROWS = [
    { customer: 'fairprice', label: 'FairPrice', has_offline: true, offline: { units: 5, revenue: 50, has_data: true } },
    { customer: 'sheng_shiong', label: 'Sheng Shiong', has_offline: true, offline: { units: 9, revenue: 20, has_data: false } },
    { customer: 'shopee', label: 'Shopee', has_offline: false, online: { units: 99, revenue: 999 } },
  ];

  test('keeps only customers on the channel, ranked by the metric', () => {
    const ranked = rankCustomers(ROWS, 'offline', 'value', 'desc', customerPalette());
    assert.deepEqual(ranked.map((row) => [row.customer, row.rank]), [['fairprice', 1], ['sheng_shiong', 2]]);
  });

  test('carries the channel totals and whether anything is loaded', () => {
    const [first, second] = rankCustomers(ROWS, 'offline', 'volume', 'desc', customerPalette());
    assert.equal(first.customer, 'sheng_shiong');
    assert.equal(first.volume, 9);
    assert.equal(first.hasData, false);
    assert.equal(second.hasData, true);
  });
});
