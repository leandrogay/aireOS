// Wording on the Forecast page's line pills and "last updated" stamp
// (forecast-frontend-update-handover F2-F6). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACTUAL_HINT,
  CURRENT_HINT,
  FORECAST_LAST_UPDATED_LABEL,
  INITIAL_HINT,
  INITIAL_MISSING_HINT,
  PREVIOUS_EMPTY_HINT,
  PREVIOUS_HINT,
  FORECAST_UPDATING_HINT,
  FORECAST_UPDATING_LABEL,
  REFRESH_STATUS_RECHECK_MS,
  TIER0_HINT,
  forecastLineHints,
  forecastUpdatingBadge,
  hasPreviousLine,
  initialStatusNotes,
  modelHint,
  nextStatusCheckDelay,
  sgtDay,
  yearsInRange,
} from '../app/utils/forecastLineText.js';

const ONE_SERIES = { singleSeries: true, initialMissingForSku: false, previousAvailable: true };

// ---- Hover text per line ----

describe('line hints', () => {
  test('every line explains itself', () => {
    const hints = forecastLineHints(ONE_SERIES);
    assert.deepEqual(hints, {
      actual: ACTUAL_HINT,
      initial: INITIAL_HINT,
      previous: PREVIOUS_HINT,
      current: CURRENT_HINT,
    });
  });

  test('the initial hint describes the September-to-December cycle, not a December freeze', () => {
    assert.match(INITIAL_HINT, /first September sales arrive/);
    assert.match(INITIAL_HINT, /locked at 23:59 on 31 December/);
    assert.doesNotMatch(INITIAL_HINT, /frozen each December/);
    assert.ok(INITIAL_HINT.endsWith('locked at 23:59 on 31 December.'));
  });

  test('a SKU with no initial values gets the history reason instead', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, initialMissingForSku: true });
    assert.equal(hints.initial, INITIAL_MISSING_HINT);
  });

  test('previous with no data says when it will appear', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, previousAvailable: false });
    assert.equal(hints.previous, 'Appears after the next month of sales.');
    assert.equal(hints.previous, PREVIOUS_EMPTY_HINT);
  });

  test('current says the forecast updates itself after saves', () => {
    assert.match(CURRENT_HINT, /updates automatically about 5–10 minutes after/);
  });

  test('current asks for one SKU and customer before the range and confidence show', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, singleSeries: false });
    assert.ok(hints.current.startsWith(CURRENT_HINT));
    assert.match(hints.current, /Pick one SKU and customer/);
  });

  test('actual says customers can end in different months', () => {
    assert.match(ACTUAL_HINT, /latest file, so months can differ between customers/);
  });
});

// ---- Previous availability ----

describe('previous line availability', () => {
  test('any month with a previous value counts', () => {
    assert.equal(hasPreviousLine([{ previous: null }, { previous: 0 }]), true);
  });

  test('no previous values, or no points, means none', () => {
    assert.equal(hasPreviousLine([{ previous: null }, { current: 5 }]), false);
    assert.equal(hasPreviousLine([]), false);
    assert.equal(hasPreviousLine(undefined), false);
  });
});

test('the stamp is labelled as the forecast update time', () => {
  assert.equal(FORECAST_LAST_UPDATED_LABEL, 'Forecast last updated');
});

// ---- Model hover (F9) ----

describe('model hover', () => {
  test('a month with any Tier 0 series explains Tier 0', () => {
    assert.equal(modelHint({ tier0_legacy: 1, tier1_arimax: 3 }), TIER0_HINT);
    assert.equal(
      TIER0_HINT,
      'Used for products with under 6 months of sales, or where it was more accurate than the Tier 1 models.'
    );
  });

  test('Tier 1 only, or no model, has no hover', () => {
    assert.equal(modelHint({ tier1_arima: 2, tier1_arimax: 1 }), '');
    assert.equal(modelHint(undefined), '');
  });
});

// ---- Initial Yearly Forecast status (F7) ----

const stamp = (value) => `at ${value}`;
const OPEN_2027 = {
  forecast_year: 2027,
  lock_at: '2026-12-31T15:59:00Z',
  refreshed_at: '2026-11-04T03:00:00Z',
  locked: false,
};

describe('initial status notes', () => {
  test('an open year says when it locks, in Singapore time, and when it last updated', () => {
    const notes = initialStatusNotes({
      rangeYears: [2027], meta: [OPEN_2027], yearsWithInitial: [], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2027 Initial: updating until 31 Dec 2026 · last updated at 2026-11-04T03:00:00Z']);
  });

  test('a locked year is a fixed plan', () => {
    const notes = initialStatusNotes({
      rangeYears: [2027], meta: [{ ...OPEN_2027, locked: true }], yearsWithInitial: [], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2027 Initial: fixed plan']);
  });

  test('a year with Initial values but no meta row (the 2026 backfill) is a fixed plan', () => {
    const notes = initialStatusNotes({
      rangeYears: [2026], meta: [OPEN_2027], yearsWithInitial: [2026, 2026], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2026 Initial: fixed plan']);
  });

  test('a year with neither gets no note, and only years in range are listed', () => {
    const notes = initialStatusNotes({
      rangeYears: [2025, 2026], meta: [OPEN_2027], yearsWithInitial: [2026], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2026 Initial: fixed plan']);
  });

  test('a range across years lists each in order', () => {
    const notes = initialStatusNotes({
      rangeYears: yearsInRange('2026-01-01', '2027-12-01'), meta: [OPEN_2027], yearsWithInitial: [2026], formatStamp: stamp,
    });
    assert.equal(notes.length, 2);
    assert.ok(notes[0].startsWith('2026 Initial: fixed plan'));
    assert.ok(notes[1].startsWith('2027 Initial: updating until 31 Dec 2026'));
  });

  test('no refreshed time drops the last-updated part', () => {
    const notes = initialStatusNotes({
      rangeYears: [2027], meta: [{ ...OPEN_2027, refreshed_at: null }], yearsWithInitial: [], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2027 Initial: updating until 31 Dec 2026']);
  });

  test('the lock day is the Singapore day, not the UTC one', () => {
    // 16:30 UTC on 31 Dec is already 1 Jan in Singapore.
    assert.equal(sgtDay('2026-12-31T16:30:00Z'), '1 Jan 2027');
    assert.equal(sgtDay(null), '');
  });

  test('years in range are every calendar year between the dates', () => {
    assert.deepEqual(yearsInRange('2025-06-01', '2027-03-01'), [2025, 2026, 2027]);
    assert.deepEqual(yearsInRange('', '2027-03-01'), []);
  });
});

// ---- "Forecast updating…" badge (F8) ----

describe('forecast updating badge', () => {
  test('a fake updating response produces the badge and its hover text', () => {
    assert.deepEqual(forecastUpdatingBadge({ updating: true, since: '2026-11-06T02:30:00Z' }), {
      label: 'Forecast updating…',
      hint: "A change was saved; the forecast refreshes about 5–10 minutes after the last change. You'll get a notification when it's done.",
    });
    assert.equal(FORECAST_UPDATING_LABEL, 'Forecast updating…');
    assert.ok(FORECAST_UPDATING_HINT.endsWith("You'll get a notification when it's done."));
  });

  test('nothing updating, or no response, shows no badge', () => {
    assert.equal(forecastUpdatingBadge({ updating: false, since: null }), null);
    assert.equal(forecastUpdatingBadge(undefined), null);
  });

  test('while updating, the status is re-checked every 60 seconds', () => {
    assert.equal(nextStatusCheckDelay({ updating: true }), 60_000);
    assert.equal(REFRESH_STATUS_RECHECK_MS, 60_000);
  });

  test('polling stops as soon as the status is not updating', () => {
    assert.equal(nextStatusCheckDelay({ updating: false, since: null }), null);
    assert.equal(nextStatusCheckDelay(undefined), null);
  });
});
