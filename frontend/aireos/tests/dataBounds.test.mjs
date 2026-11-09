// Period / Compare to options limited to the ticked customers' loaded data.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isWithinData, outsideDataNote } from '../app/utils/dataBounds.js';

// Customer A has May - Jun 2026, customer B Jun - Jul 2026.
const A_ONLY = ['2026-05-01', '2026-06-30'];
const A_AND_B = ['2026-05-01', '2026-07-31'];

describe('isWithinData', () => {
  test('with A and B ticked, May - Jul is inside', () => {
    assert.equal(isWithinData({ start: '2026-05-01', end: '2026-07-31' }, ...A_AND_B), true);
  });

  test('with only A ticked, July is outside', () => {
    assert.equal(isWithinData({ start: '2026-06-01', end: '2026-07-31' }, ...A_ONLY), false);
  });

  test('with only A ticked, April is outside', () => {
    assert.equal(isWithinData({ start: '2026-04-01', end: '2026-05-31' }, ...A_ONLY), false);
  });

  test('a month whose data stops mid-month is still inside', () => {
    assert.equal(isWithinData({ start: '2026-06-01', end: '2026-06-30' }, '2026-05-01', '2026-06-19'), true);
  });

  test('while the bounds are loading nothing is outside', () => {
    assert.equal(isWithinData({ start: '2020-01-01', end: '2030-12-31' }, '', ''), true);
  });
});

describe('outsideDataNote', () => {
  test('names the loaded months', () => {
    assert.equal(outsideDataNote(...A_ONLY), 'Only May 2026 – Jun 2026 has data for the selected customers');
  });
});
