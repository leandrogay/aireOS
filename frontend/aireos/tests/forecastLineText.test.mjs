// Wording on the Forecast page's line pills and "last updated" stamp
// (forecast-frontend-update-handover F2-F6). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACTUAL_HINT,
  CURRENT_HINT,
  FORECAST_LAST_UPDATED_LABEL,
  INITIAL_HINT,
  PREVIOUS_HINT,
  PREVIOUS_MISSING_HINT,
  FORECAST_UPDATING_HINT,
  FORECAST_UPDATING_LABEL,
  REFRESH_STATUS_RECHECK_MS,
  TIER0_HINT,
  CONFIDENCE_DOT_FILL,
  confidenceWords,
  forecastLineHints,
  INITIAL_CONFIDENCE_INFO,
  initialVsActualText,
  initialMissingHint,
  lineCoverageNote,
  pastAccuracyBadgeLabel,
  currentHint,
  dataMonthLabel,
  dataMonthLines,
  dataMonthsText,
  previousHint,
  rangeChanceText,
  shownRangeLow,
  unavailableReasonText,
  rangePctText,
  smapeText,
  tierUnavailableText,
  forecastUpdatingBadge,
  INITIAL_UPDATING_HINT,
  initialStatusNotes,
  nextStatusCheckDelay,
  sgtDay,
  yearsInRange,
} from '../app/utils/forecastLineText.js';

const ONE_SERIES = { initialMissing: '', previousMissing: false };

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

  test('the initial hint says it is always made with Tier 0, whichever model is selected', () => {
    assert.match(INITIAL_HINT, /always made with the Tier 0 model, whichever model is selected/);
  });

  test('the initial hint describes the 1 Sep to 31 Oct cycle, not a December lock', () => {
    assert.match(INITIAL_HINT, /made from 1 Sep/);
    assert.match(INITIAL_HINT, /locked at the end of 31 Oct/);
    assert.doesNotMatch(INITIAL_HINT, /31 December|23:59/);
  });

  test('a missing Initial is never blamed on the model: the plan is Tier 0 on every model', () => {
    assert.equal(
      initialMissingHint({ tier: 'tier1_basic', years: [2026] }),
      initialMissingHint({ tier: 'tier0', years: [2026] })
    );
    assert.doesNotMatch(initialMissingHint({ years: [2026] }), /12\+ months|for this model/);
  });

  test('a Tier 0 SKU with no Initial launched after that year\'s plan was made', () => {
    assert.equal(
      initialMissingHint({ tier: 'tier0', years: [2026] }),
      'No Initial yearly forecast: this SKU launched after the 2026 plan was made.'
    );
    assert.equal(
      initialMissingHint({ tier: 'tier0', years: [2026, 2027], skuCount: 2 }),
      'No Initial yearly forecast: these SKUs launched after the 2026 and 2027 plans were made.'
    );
  });

  test('previous is the same model with one month less sales, naming the month', () => {
    assert.equal(
      previousHint('Sep 2026'),
      "Previous forecast: the same model's forecast with one month less sales data (made with sales up to " +
        "Sep 2026). Compare it with Current to see what the newest month changed. It's rebuilt at every update, " +
        'so it always means "one month less data", whatever order files were uploaded in.'
    );
    assert.equal(
      forecastLineHints({ ...ONE_SERIES, previousMonths: 'Sep 2026' }).previous,
      previousHint('Sep 2026')
    );
  });

  test('previous without a known month leaves the brackets out', () => {
    assert.doesNotMatch(PREVIOUS_HINT, /sales up to|\(\)/);
    assert.match(PREVIOUS_HINT, /one month less sales data\. Compare it/);
  });

  test('no Previous wording talks about an earlier run or last month\'s forecast', () => {
    for (const text of [PREVIOUS_HINT, previousHint('Sep 2026'), PREVIOUS_MISSING_HINT]) {
      assert.doesNotMatch(text, /earlier run|earlier month|last month's forecast|made before/);
    }
  });

  test('a model with no Previous for the SKU says it needs two months of sales, per SKU and tier', () => {
    const hints = forecastLineHints({ ...ONE_SERIES, previousMissing: true, previousMonths: 'Sep 2026' });
    assert.equal(hints.previous, PREVIOUS_MISSING_HINT);
    assert.equal(
      PREVIOUS_MISSING_HINT,
      'No Previous for this model yet — it appears once this product has two months of sales (or once it has ' +
        'enough history for this model).'
    );
  });

  test('current names the sales month it was made with and the 12 months it shows', () => {
    const hint = forecastLineHints({ ...ONE_SERIES, currentMonths: 'Oct 2026' }).current;
    assert.equal(hint, currentHint('Oct 2026'));
    assert.equal(hint, 'Current forecast: the latest forecast, made with sales up to Oct 2026. Shows the 12 months after that.');
    assert.doesNotMatch(CURRENT_HINT, /sales up to/);
  });

  test('no line pill talks about a drawn 80% range any more', () => {
    for (const hint of Object.values(forecastLineHints(ONE_SERIES))) {
      assert.doesNotMatch(hint, /80% range/);
    }
  });

  test('actual says customers can end in different months', () => {
    assert.match(ACTUAL_HINT, /A month the customer hasn't sent is shown as Missing, never 0/);
  });
});

// ---- What each line was made with ----

describe('data months', () => {
  const label = (name) => ({ fairprice: 'FairPrice', nhg: 'NHG' })[name] ?? name;
  const entry = (customerName, productName, month) => ({ customerName, productName, month });

  test('a month is shown as MMM YYYY, never shifted', () => {
    assert.equal(dataMonthLabel('2026-09-01'), 'Sep 2026');
    assert.equal(dataMonthLabel('2026-12-01'), 'Dec 2026');
    assert.equal(dataMonthLabel('2027-01-01'), 'Jan 2027');
    assert.equal(dataMonthLabel(null), '');
  });

  test('one month for every SKU is one line', () => {
    const entries = [entry('fairprice', 'Pants L', '2026-09-01'), entry('fairprice', 'Pants XL', '2026-09-01')];
    assert.deepEqual(dataMonthLines(entries, label), ['Made with sales up to Sep 2026']);
    assert.equal(dataMonthsText(entries, label), 'Sep 2026');
  });

  test('customers on the same month need no per-customer rows', () => {
    const entries = [entry('fairprice', 'Pants L', '2026-09-01'), entry('nhg', 'Pants L', '2026-09-01')];
    assert.deepEqual(dataMonthLines(entries, label), ['Made with sales up to Sep 2026']);
  });

  test('customers on different months get a row each', () => {
    const entries = [
      entry('nhg', 'Pants L', '2026-08-01'),
      entry('fairprice', 'Pants L', '2026-09-01'),
      entry('fairprice', 'Pants XL', '2026-09-01'),
    ];
    assert.deepEqual(dataMonthLines(entries, label), [
      'FairPrice: sales up to Sep 2026',
      'NHG: sales up to Aug 2026',
    ]);
    assert.equal(dataMonthsText(entries, label), 'FairPrice: Sep 2026 · NHG: Aug 2026');
  });

  test('a SKU behind the rest of its customer is named', () => {
    const entries = [
      entry('fairprice', 'Pants L', '2026-09-01'),
      entry('fairprice', 'Pants XL', '2026-09-01'),
      entry('fairprice', 'Pants M', '2026-08-01'),
    ];
    assert.deepEqual(dataMonthLines(entries, label), ['Made with sales up to Sep 2026 (Pants M: Aug 2026)']);
    assert.equal(dataMonthsText(entries, label), 'Sep 2026 (Pants M: Aug 2026)');
  });

  test('a customer with odd SKUs keeps them beside its own row', () => {
    const entries = [
      entry('fairprice', 'Pants L', '2026-09-01'),
      entry('fairprice', 'Pants M', '2026-08-01'),
      entry('fairprice', 'Pants XL', '2026-09-01'),
      entry('nhg', 'Pants L', '2026-08-01'),
    ];
    assert.equal(dataMonthsText(entries, label), 'FairPrice: Sep 2026 (Pants M: Aug 2026) · NHG: Aug 2026');
  });

  test('many customers collapse to +N more', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`c${i}`, 'Pants L', i % 2 ? '2026-08-01' : '2026-09-01'));
    const lines = dataMonthLines(entries, label);
    assert.equal(lines.length, 7);
    assert.equal(lines.at(-1), '+2 more');
  });

  test('no months, no line', () => {
    assert.deepEqual(dataMonthLines([], label), []);
    assert.equal(dataMonthsText([], label), '');
  });
});

test('the stamp is labelled as the forecast update time', () => {
  assert.equal(FORECAST_LAST_UPDATED_LABEL, 'Forecast last updated');
});

// ---- Model picker wording ----

describe('model picker wording', () => {
  test('Tier 0 is described as a baseline for every SKU, not a best-model choice', () => {
    assert.match(TIER0_HINT, /half of the same month last year plus half of the average of the last 3 months/);
    assert.match(TIER0_HINT, /Available for every SKU, including new ones/);
    assert.doesNotMatch(TIER0_HINT, /more accurate|under 6 months/);
  });

  test('every greyed-out reason reads as a sentence', () => {
    const cases = {
      not_enough_history: "Needs 12 months of sales; this product has 8. Months with no sales file don't count.",
      no_familiar_promotions:
        'No promotion planned in the next 12 months that this product has run at least 3 times before, so ' +
        "promotions can't add anything over Tier 1 Basic yet.",
      incomplete_forecast: "This model didn't produce a full 12 months for this product in the latest update.",
      not_backtested:
        "This model hasn't been accuracy-tested on this product yet (it needs enough past months to test on).",
      no_forecast: 'No forecast from this model for this product yet.',
    };
    for (const [reason, text] of Object.entries(cases)) {
      assert.equal(unavailableReasonText(reason, { monthsOfHistory: 8 }), text, reason);
    }
  });

  test('without its months of history, not enough history leaves the count out', () => {
    assert.equal(
      unavailableReasonText('not_enough_history'),
      "Needs 12 months of sales. Months with no sales file don't count."
    );
  });

  test('one SKU gets its own reason, with its months of sales', () => {
    assert.equal(
      tierUnavailableText({ reasons: ['not_enough_history'], total: 1, monthsOfHistory: 5 }),
      "Needs 12 months of sales; this product has 5. Months with no sales file don't count."
    );
  });

  test('several SKUs say how many can not use the model', () => {
    assert.equal(
      tierUnavailableText({ reasons: ['not_enough_history', 'not_backtested'], total: 5 }),
      'Not available for 2 of 5 selected SKUs'
    );
    assert.equal(
      tierUnavailableText({ reasons: ['not_enough_history', 'not_enough_history'], total: 5, monthsOfHistory: 5 }),
      "Not available for 2 of 5 selected SKUs · Needs 12 months of sales. Months with no sales file don't count."
    );
  });

  test('an unknown or missing reason still reads as a sentence', () => {
    assert.equal(tierUnavailableText({ reasons: [null], total: 1 }), 'Not available for this SKU');
    assert.equal(tierUnavailableText({ reasons: [], total: 3 }), '');
  });

  test('a partial Initial or Previous is called out, all or none is not', () => {
    assert.equal(
      lineCoverageNote('Initial yearly forecast', { withLine: 3, total: 5 }),
      'Initial yearly forecast: shown for 3 of 5 selected SKUs.'
    );
    assert.equal(lineCoverageNote('Previous', { withLine: 5, total: 5 }), '');
    assert.equal(lineCoverageNote('Previous', { withLine: 0, total: 5 }), '');
  });

  test('no wording describes a best-model choice', () => {
    for (const text of [TIER0_HINT, PREVIOUS_HINT, CURRENT_HINT, INITIAL_HINT]) {
      assert.doesNotMatch(text, /best model|best-model/i);
    }
  });
});

// ---- Confidence wording ----

describe('range bounds', () => {
  test('a negative lower bound shows as 0', () => {
    assert.equal(shownRangeLow(-4), 0);
    assert.equal(shownRangeLow(12.5), 12.5);
    assert.equal(shownRangeLow(null), null);
  });
});

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

  test('the hover card names the month band in plain words beside its dot', () => {
    assert.equal(confidenceWords('low'), 'Low confidence');
    assert.equal(confidenceWords('high'), 'High confidence');
    assert.equal(confidenceWords(null), 'Unknown confidence');
  });

  test('each band has its own dot fill, never colour alone', () => {
    assert.deepEqual(CONFIDENCE_DOT_FILL, { high: 'filled', medium: 'half', low: 'hollow', unknown: 'small' });
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
      hint: FORECAST_UPDATING_HINT,
    });
    assert.equal(FORECAST_UPDATING_LABEL, 'Forecast updating…');
    assert.ok(FORECAST_UPDATING_HINT.endsWith('the page shows the new numbers after that.'));
  });

  test('while an Initial year is still open, the badge names the forecast and the Initial line', () => {
    const badge = forecastUpdatingBadge({ updating: true, since: '2026-11-06T02:30:00Z' }, [OPEN_2027]);
    assert.equal(badge.label, 'Forecast updating… (incl. Initial)');
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

describe('initial vs actual wording', () => {
  test('over and under name the % of the actual and the cartons', () => {
    assert.equal(initialVsActualText({ diff: 197, pct: 8.48 }), '8% over actual (197 cartons)');
    assert.equal(initialVsActualText({ diff: -1204.6, pct: -12.2 }), '12% under actual (1,205 cartons)');
  });

  test('an actual of 0 shows only the cartons', () => {
    assert.equal(initialVsActualText({ diff: 50, pct: null }), '50 cartons over actual');
  });

  test('less than half a carton apart reads as matched', () => {
    assert.equal(initialVsActualText({ diff: 0.3, pct: 0.1 }), 'matched actual');
  });
});

test('the confidence help explains when the Initial range is fixed and why it widens', () => {
  assert.match(INITIAL_CONFIDENCE_INFO, /locks at the end of 31 Oct/);
  assert.match(INITIAL_CONFIDENCE_INFO, /wider for later months/);
});
