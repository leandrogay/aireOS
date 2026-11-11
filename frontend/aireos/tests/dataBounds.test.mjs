// Period / Compare to options limited to the ticked customers' loaded data.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { comparisonInUse, isWithinData, outsideDataNote, periodInUse } from '../app/utils/dataBounds.js';

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
    assert.equal(outsideDataNote(...A_ONLY), 'Outside May – Jun 2026, the months with data for at least one selected customer');
  });
});

// ---- The Period / Compare to the page uses ----

const OCT_2026 = { start: '2026-10-01', end: '2026-10-31' };
const AUG_2026 = { start: '2026-08-01', end: '2026-08-31' };
// FairPrice's data: Dec 2024 - Aug 2026. SingHealth's: Mar - Oct 2026.
const FAIRPRICE = { earliestDataStart: '2024-12-01', latestDataEnd: '2026-08-31' };
const SINGHEALTH = { earliestDataStart: '2026-03-01', latestDataEnd: '2026-10-31' };

describe('periodInUse', () => {
  test('a pick inside the data applies', () => {
    assert.deepEqual(periodInUse(AUG_2026, OCT_2026, SINGHEALTH), { ...AUG_2026, picked: true });
  });

  test('a pick outside the data falls back to the default', () => {
    assert.deepEqual(periodInUse(OCT_2026, AUG_2026, FAIRPRICE), { ...AUG_2026, picked: false });
  });

  test('while the bounds are updating the pick stands', () => {
    assert.deepEqual(periodInUse(OCT_2026, AUG_2026, { ...FAIRPRICE, updating: true }), { ...OCT_2026, picked: true });
  });

  test('nothing picked uses the default', () => {
    assert.deepEqual(periodInUse({ start: '', end: '' }, AUG_2026, FAIRPRICE), { ...AUG_2026, picked: false });
  });
});

describe('comparisonInUse', () => {
  const inputs = { ...OCT_2026, latestWeekStart: '', latestDataEnd: '2026-10-31', custom: { start: '', end: '' } };

  test('last year outside the data shows as no comparison', () => {
    const result = comparisonInUse('last-year', inputs, SINGHEALTH);
    assert.equal(result.compareTo, 'none');
    assert.equal(result.baseline, null);
  });

  test('the previous period inside the data is kept', () => {
    const result = comparisonInUse('previous', inputs, SINGHEALTH);
    assert.equal(result.compareTo, 'previous');
    assert.deepEqual([result.baseline.start, result.baseline.end], ['2026-09-01', '2026-09-30']);
  });

  test('while the bounds are updating the choice stands', () => {
    assert.equal(comparisonInUse('last-year', inputs, { ...SINGHEALTH, updating: true }).compareTo, 'last-year');
  });
});
