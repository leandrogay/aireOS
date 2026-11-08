// Helpers behind ui/DatePicker and ui/RangeDatePicker. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  monthLimits,
  nextRangeDraft,
  outsideLimits,
  parseYmd,
  rangeSummary,
  toYmd,
} from '../app/utils/datePicker.js';

// A stand-in for lib/formatDate.formatDate, which needs the Next.js resolver.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const format = (ymd) => `${Number(ymd.slice(8))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;

// ---- parseYmd / toYmd ----

describe('parseYmd and toYmd', () => {
  test('a date survives the round trip unchanged', () => {
    assert.equal(toYmd(parseYmd('2026-03-09')), '2026-03-09');
  });

  test('empty, malformed and impossible dates parse to undefined', () => {
    assert.equal(parseYmd(''), undefined);
    assert.equal(parseYmd('09/03/2026'), undefined);
    assert.equal(parseYmd('2026-02-30'), undefined);
  });
});

// ---- limits ----

describe('outsideLimits and monthLimits', () => {
  test('only the limits that are set become disabled matchers', () => {
    assert.deepEqual(outsideLimits('', ''), []);
    const [before] = outsideLimits('2026-01-15', '');
    assert.equal(toYmd(before.before), '2026-01-15');
  });

  test('month limits follow min/max, else a window around today', () => {
    const today = new Date(2026, 10, 6);
    const set = monthLimits('2025-04-20', '2026-12-31', today);
    assert.equal(toYmd(set.startMonth), '2025-04-01');
    assert.equal(toYmd(set.endMonth), '2026-12-01');
    const open = monthLimits('', '', today);
    assert.equal(toYmd(open.startMonth), '2016-01-01');
    assert.equal(toYmd(open.endMonth), '2031-12-01');
  });
});

// ---- nextRangeDraft ----

describe('nextRangeDraft', () => {
  test('the first click sets the start only', () => {
    assert.deepEqual(nextRangeDraft({ start: '', end: '' }, '2026-03-12'), { start: '2026-03-12', end: '' });
  });

  test('the second click sets the end, the same day makes a one-day range', () => {
    assert.deepEqual(nextRangeDraft({ start: '2026-03-12', end: '' }, '2026-04-30'), { start: '2026-03-12', end: '2026-04-30' });
    assert.deepEqual(nextRangeDraft({ start: '2026-03-12', end: '' }, '2026-03-12'), { start: '2026-03-12', end: '2026-03-12' });
  });

  test('an earlier second click or a click on a finished range starts again', () => {
    assert.deepEqual(nextRangeDraft({ start: '2026-03-12', end: '' }, '2026-03-01'), { start: '2026-03-01', end: '' });
    assert.deepEqual(nextRangeDraft({ start: '2026-03-12', end: '2026-04-30' }, '2026-05-02'), { start: '2026-05-02', end: '' });
  });
});

// ---- rangeSummary ----

describe('rangeSummary', () => {
  test('a range inside one year shows the year once', () => {
    assert.equal(rangeSummary('2026-03-12', '2026-04-30', format), '12 Mar – 30 Apr 2026');
  });

  test('a range across years shows both years', () => {
    assert.equal(rangeSummary('2025-12-20', '2026-01-05', format), '20 Dec 2025 – 5 Jan 2026');
  });

  test('a half-set range has no summary', () => {
    assert.equal(rangeSummary('2026-03-12', '', format), '');
  });
});
