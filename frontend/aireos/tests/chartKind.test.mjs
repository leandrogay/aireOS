// Bars or lines for the dashboard trend chart: customers x periods against
// the desktop (12) and mobile (3) limits. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { barCount, trendChartKind } from '../app/utils/chartKind.js';

// ---- Desktop ----

describe('desktop', () => {
  test('4 customers x 3 periods (12 bars) stays bars', () => {
    assert.equal(trendChartKind({ customerCount: 4, periodCount: 3, mobile: false }), 'bars');
  });

  test('4 customers x 4 periods (16 bars) turns to lines', () => {
    assert.equal(trendChartKind({ customerCount: 4, periodCount: 4, mobile: false }), 'lines');
  });

  test('1 customer x 12 months stays bars, 13 turns to lines', () => {
    assert.equal(trendChartKind({ customerCount: 1, periodCount: 12, mobile: false }), 'bars');
    assert.equal(trendChartKind({ customerCount: 1, periodCount: 13, mobile: false }), 'lines');
  });
});

// ---- Mobile ----

describe('mobile', () => {
  test('1 customer x 3 periods (3 bars) stays bars', () => {
    assert.equal(trendChartKind({ customerCount: 1, periodCount: 3, mobile: true }), 'bars');
  });

  test('1 customer x 4 periods (4 bars) turns to lines', () => {
    assert.equal(trendChartKind({ customerCount: 1, periodCount: 4, mobile: true }), 'lines');
  });

  test('2 customers x 2 periods (4 bars) turns to lines', () => {
    assert.equal(trendChartKind({ customerCount: 2, periodCount: 2, mobile: true }), 'lines');
  });
});

// ---- One period ----

describe('one period', () => {
  test('5 customers x 1 month on a phone stays bars, though over the limit', () => {
    assert.equal(trendChartKind({ customerCount: 5, periodCount: 1, mobile: true }), 'bars');
  });

  test('20 customers x 1 month on desktop stays bars', () => {
    assert.equal(trendChartKind({ customerCount: 20, periodCount: 1, mobile: false }), 'bars');
  });
});

describe('barCount', () => {
  test('is customers times periods', () => {
    assert.equal(barCount(4, 3), 12);
  });
});
