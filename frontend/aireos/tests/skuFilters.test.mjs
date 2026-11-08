// SKU catalog filtering and the price filter's text. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EMPTY_SKU_FILTERS, filterSkus, hasSkuFilters } from '../app/utils/skuFilters.js';
import { isPriceRangeInverted, priceRangeSummary } from '../app/utils/priceRange.js';

const SKUS = [
  { sku: '1', product_name: 'Pants L', sku_range: 'Pants', brand: 'AIRE', price: '14.00' },
  { sku: '2', product_name: 'Tape L', sku_range: 'Tape', brand: 'AIRE', price: '22.00' },
  { sku: '3', product_name: 'Wipes', sku_range: 'Wipes', brand: 'OTHER', price: null },
];

const codes = (rows) => rows.map((row) => row.sku);
const withFilters = (changes) => ({ ...EMPTY_SKU_FILTERS, ...changes });

// ---- filterSkus ----

describe('filterSkus', () => {
  test('no filters and no search keeps every SKU', () => {
    assert.deepEqual(codes(filterSkus(SKUS, EMPTY_SKU_FILTERS, '')), ['1', '2', '3']);
  });

  test('several ranges keep SKUs in any of them', () => {
    assert.deepEqual(codes(filterSkus(SKUS, withFilters({ skuRanges: ['Pants', 'Wipes'] }), '')), ['1', '3']);
  });

  test('ranges and brands combine with AND', () => {
    const filters = withFilters({ skuRanges: ['Pants', 'Wipes'], brands: ['AIRE'] });
    assert.deepEqual(codes(filterSkus(SKUS, filters, '')), ['1']);
  });

  test('a price bound leaves out SKUs with no current price', () => {
    assert.deepEqual(codes(filterSkus(SKUS, withFilters({ minPrice: '0' }), '')), ['1', '2']);
  });

  test('min and max are inclusive', () => {
    assert.deepEqual(codes(filterSkus(SKUS, withFilters({ minPrice: '14', maxPrice: '22' }), '')), ['1', '2']);
  });

  test('search applies alongside the filters', () => {
    assert.deepEqual(codes(filterSkus(SKUS, withFilters({ brands: ['AIRE'] }), 'tape')), ['2']);
  });
});

// ---- hasSkuFilters ----

describe('hasSkuFilters', () => {
  test('empty filters and blank search is not filtering', () => {
    assert.equal(hasSkuFilters(EMPTY_SKU_FILTERS, '  '), false);
  });

  test('a ticked brand is filtering', () => {
    assert.equal(hasSkuFilters(withFilters({ brands: ['AIRE'] }), ''), true);
  });
});

// ---- priceRange ----

describe('priceRangeSummary', () => {
  test('no bounds reads Any price', () => {
    assert.equal(priceRangeSummary('', ''), 'Any price');
  });

  test('both bounds read as a range', () => {
    assert.equal(priceRangeSummary('10', '20'), '$10.00 – $20.00');
  });

  test('one bound reads From or Up to', () => {
    assert.equal(priceRangeSummary('10', ''), 'From $10.00');
    assert.equal(priceRangeSummary('', '20'), 'Up to $20.00');
  });
});

describe('isPriceRangeInverted', () => {
  test('min above max is inverted; equal or one-sided is not', () => {
    assert.equal(isPriceRangeInverted('20', '10'), true);
    assert.equal(isPriceRangeInverted('10', '10'), false);
    assert.equal(isPriceRangeInverted('20', ''), false);
  });
});
