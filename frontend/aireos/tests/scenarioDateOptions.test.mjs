import test from 'node:test';
import assert from 'node:assert/strict';

import { promotionDayOptions } from '../app/utils/scenarioDateOptions.js';

test('side offers can choose every day through the end of the last forecast month', () => {
  const options = promotionDayOptions(['2026-12-01', '2026-11-01']);

  assert.equal(options.length, 61);
  assert.deepEqual(options[0], { date: '2026-11-01', locked: false });
  assert.deepEqual(options.at(-1), { date: '2026-12-31', locked: false });
});

test('day choices include leap day only in a leap year', () => {
  assert.equal(promotionDayOptions(['2028-02-01']).length, 29);
  assert.equal(promotionDayOptions(['2027-02-01']).length, 28);
});

test('saved off-chart dates stay visible and disabled without duplicating dates in view', () => {
  const options = promotionDayOptions(['2026-11-01', '2026-11-01'], ['2026-10-28', '2026-11-05', '2026-12-02']);

  assert.equal(options.length, 32);
  assert.deepEqual(options[0], { date: '2026-10-28', locked: true });
  assert.deepEqual(options.at(-1), { date: '2026-12-02', locked: true });
  assert.deepEqual(options.find((option) => option.date === '2026-11-05'), { date: '2026-11-05', locked: false });
});

test('an empty forecast keeps only valid saved dates, all disabled', () => {
  assert.deepEqual(promotionDayOptions([], ['', undefined, '2026-02-30', '2026-11-05']), [
    { date: '2026-11-05', locked: true },
  ]);
  assert.deepEqual(promotionDayOptions([]), []);
});
