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
  initialPartialNote,
  pastAccuracyBadgeLabel,
  rangeChanceText,
  rangePctText,
  smapeText,
  tierUnavailableText,
  forecastUpdatingBadge,
  INITIAL_UPDATING_HINT,
  hasPreviousLine,
  initialStatusNotes,
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

  test('a model with no initial values gets the 12-month history reason instead', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, initialMissingForSku: true });
    assert.equal(hints.initial, INITIAL_MISSING_HINT);
    assert.equal(
      INITIAL_MISSING_HINT,
      'No Initial yearly forecast for this model — it needs 12+ months of history at the time the yearly plan was made.'
    );
  });

  test('previous with no data says when it will appear', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, previousAvailable: false });
    assert.equal(hints.previous, 'Appears after the next month of sales.');
    assert.equal(hints.previous, PREVIOUS_EMPTY_HINT);
  });

  test('current says the forecast updates itself after saves', () => {
    assert.match(CURRENT_HINT, /updates automatically about 5–10 minutes after/);
  });

  test('current asks for one SKU and customer before the 80% range shows', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, singleSeries: false });
    assert.ok(hints.current.startsWith(CURRENT_HINT));
    assert.match(hints.current, /Pick one SKU and customer to see the 80% range/);
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

// ---- Model picker wording ----

describe('model picker wording', () => {
  test('Tier 0 is described as a baseline for every SKU, not a best-model choice', () => {
    assert.equal(TIER0_HINT, "Baseline from recent sales and last year's pattern. Available for every SKU.");
    assert.doesNotMatch(TIER0_HINT, /more accurate|under 6 months/);
  });

  test('one SKU gets its own reason in plain words', () => {
    assert.equal(tierUnavailableText({ reasons: ['not_enough_history'], total: 1 }), 'Needs 12+ months of sales history');
    assert.equal(
      tierUnavailableText({ reasons: ['no_familiar_promotions'], total: 1 }),
      'No familiar promotions in the next 12 months'
    );
  });

  test('several SKUs say how many can not use the model', () => {
    assert.equal(
      tierUnavailableText({ reasons: ['not_enough_history', 'not_backtested'], total: 5 }),
      'Not available for 2 of 5 selected SKUs'
    );
    assert.equal(
      tierUnavailableText({ reasons: ['not_enough_history', 'not_enough_history'], total: 5 }),
      'Not available for 2 of 5 selected SKUs · Needs 12+ months of sales history'
    );
  });

  test('an unknown or missing reason still reads as a sentence', () => {
    assert.equal(tierUnavailableText({ reasons: [null], total: 1 }), 'Not available for this SKU');
    assert.equal(tierUnavailableText({ reasons: [], total: 3 }), '');
  });

  test('a partial Initial is called out, all or none is not', () => {
    assert.match(initialPartialNote({ withInitial: 3, total: 5 }), /covers 3 of 5 SKUs/);
    assert.equal(initialPartialNote({ withInitial: 5, total: 5 }), '');
    assert.equal(initialPartialNote({ withInitial: 0, total: 5 }), '');
  });
});

// ---- Confidence wording ----

describe('confidence wording', () => {
  test('this month reads as a +/- range and an 8 in 10 chance', () => {
    assert.equal(rangePctText(30), '±30%');
    assert.equal(rangePctText(null), '');
    assert.equal(rangeChanceText('700', '1,300'), '8 in 10 chance it lands between 700 and 1,300');
    assert.equal(rangeChanceText('', '1,300'), '');
  });

  test('past accuracy shows the sMAPE, or says it is untested', () => {
    assert.equal(smapeText(12.4), 'sMAPE 12%');
    assert.equal(smapeText(null), 'not tested yet');
  });

  test('the legend badge names the band and the sMAPE', () => {
    assert.equal(pastAccuracyBadgeLabel({ band: 'high', smape: 12.4 }), 'Past accuracy: High · sMAPE 12%');
    assert.equal(pastAccuracyBadgeLabel({ band: null, smape: null }), 'Past accuracy: Unknown · not tested yet');
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
      rangeYears: [2027], meta: [OPEN_2027], formatStamp: stamp,
    });
    assert.deepEqual(notes, ['2027 Initial: updating until 31 Dec 2026 · last updated at 2026-11-04T03:00:00Z']);
  });

  test('a locked year gets no note', () => {
    const notes = initialStatusNotes({
      rangeYears: [2027], meta: [{ ...OPEN_2027, locked: true }], formatStamp: stamp,
    });
    assert.deepEqual(notes, []);
  });

  test('a year with no meta row (the 2026 backfill) gets no note', () => {
    const notes = initialStatusNotes({
      rangeYears: [2026], meta: [OPEN_2027], formatStamp: stamp,
    });
    assert.deepEqual(notes, []);
  });

  test('only open years in range are listed', () => {
    const notes = initialStatusNotes({
      rangeYears: yearsInRange('2026-01-01', '2027-12-01'), meta: [OPEN_2027], formatStamp: stamp,
    });
    assert.equal(notes.length, 1);
    assert.ok(notes[0].startsWith('2027 Initial: updating until 31 Dec 2026'));
  });

  test('no refreshed time drops the last-updated part', () => {
    const notes = initialStatusNotes({
      rangeYears: [2027], meta: [{ ...OPEN_2027, refreshed_at: null }], formatStamp: stamp,
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

  test('while an Initial year is still open, the badge names the Initial Yearly Forecast', () => {
    const badge = forecastUpdatingBadge({ updating: true, since: '2026-11-06T02:30:00Z' }, [OPEN_2027]);
    assert.equal(badge.label, 'Initial Yearly Forecast updating…');
    assert.equal(badge.hint, INITIAL_UPDATING_HINT);
  });

  test('only locked Initial years keep the plain forecast badge', () => {
    const badge = forecastUpdatingBadge({ updating: true }, [{ ...OPEN_2027, locked: true }]);
    assert.equal(badge.label, 'Forecast updating…');
  });

  test('an open Initial year with nothing updating shows no badge', () => {
    assert.equal(forecastUpdatingBadge({ updating: false, since: null }, [OPEN_2027]), null);
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
