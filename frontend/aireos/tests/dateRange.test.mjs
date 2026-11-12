import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentYearDateRange, nextYearDateRange } from '../app/utils/dateRange.js';

// Mid-2026 in Singapore, as singaporeToday() would return it.
const TODAY = new Date(2026, 6, 15);

test('the current year is the default when the data covers it', () => {
  assert.deepEqual(currentYearDateRange({ start: '2024-01-01', end: '2027-11-01' }, TODAY), {
    start: '2026-01-01',
    end: '2026-12-01',
  });
});

test('next year opens the Scenario builder in 2027 when it is 2026', () => {
  assert.deepEqual(nextYearDateRange({ start: '2024-01-01', end: '2028-06-01' }, TODAY), {
    start: '2027-01-01',
    end: '2027-12-01',
  });
});

test('next year stops where the forecast ends', () => {
  assert.deepEqual(nextYearDateRange({ start: '2024-01-01', end: '2027-11-01' }, TODAY), {
    start: '2027-01-01',
    end: '2027-11-01',
  });
});

test('next year falls back to this year when the forecast does not reach it', () => {
  assert.deepEqual(nextYearDateRange({ start: '2024-01-01', end: '2026-10-01' }, TODAY), {
    start: '2026-01-01',
    end: '2026-10-01',
  });
});

test('with no bounds yet next year is the whole calendar year', () => {
  assert.deepEqual(nextYearDateRange({}, TODAY), { start: '2027-01-01', end: '2027-12-01' });
});
