// Wording the bell shows for forecast notifications (handover 5.2.1).
// Run with `npm test` -- Node's built-in test runner, no extra packages.
// The panel builds its title and "Started by" from these helpers, so a change
// to the wording here (or a payload rename on the backend) fails these tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  forecastErrorLines,
  forecastIntro,
  forecastTitle,
  isRefreshFailure,
  startedByLabel,
} from '../app/utils/forecastNotificationText.js';

const DATE = '5 Nov 2026';
const REASON = 'Sales data did not reach BigQuery within 2 hours';

// ---- Titles ----

describe('forecast notification titles', () => {
  test('a refresh that never started gets its own title', () => {
    const payload = { stage: 'refresh', reason: REASON, errors: [] };

    assert.equal(forecastTitle(payload, false, DATE), "[FAILURE] Forecast refresh couldn't start – 5 Nov 2026");
    assert.ok(isRefreshFailure(payload, false));
  });

  test('a normal pipeline failure keeps the old title', () => {
    assert.equal(forecastTitle({ errors: ['boom'] }, false, DATE), '[FAILURE] Forecast Pipeline Failed – 5 Nov 2026');
    assert.equal(
      forecastTitle({ stage: 'pipeline' }, false, DATE),
      '[FAILURE] Forecast Pipeline Failed – 5 Nov 2026',
    );
  });

  test('a success keeps the old title', () => {
    assert.equal(forecastTitle({}, true, DATE), '[SUCCESS] Forecast Pipeline Completed – 5 Nov 2026');
  });

  test('a success is never treated as a refresh failure', () => {
    assert.equal(isRefreshFailure({ stage: 'refresh' }, true), false);
    assert.equal(forecastTitle({ stage: 'refresh' }, true, DATE), '[SUCCESS] Forecast Pipeline Completed – 5 Nov 2026');
  });
});

// ---- Detail text ----

describe('forecast notification details', () => {
  test('a refresh failure explains the forecast was not updated', () => {
    assert.match(forecastIntro({ stage: 'refresh' }, false), /could not start/);
  });

  test('errors that only repeat the reason are not listed twice', () => {
    assert.deepEqual(forecastErrorLines({ reason: REASON, errors: [REASON] }), []);
    assert.deepEqual(forecastErrorLines({ reason: 'Query failed', errors: ['Query failed', 'Row 3 bad'] }), ['Row 3 bad']);
  });

  test('older failures without a reason still list their errors', () => {
    assert.deepEqual(forecastErrorLines({ errors: ['Data checks failed'] }), ['Data checks failed']);
    assert.deepEqual(forecastErrorLines({}), []);
  });
});

// ---- Started by ----

describe('started by label', () => {
  test('an app save reads as a sales/promotion change', () => {
    assert.equal(startedByLabel('event'), 'Sales/promotion change');
  });

  test('the schedule and the script keep their labels', () => {
    assert.equal(startedByLabel('scheduled'), 'Scheduled run');
    assert.equal(startedByLabel('script'), 'Forecast script');
  });

  test('a notification with no source falls back to the script label', () => {
    assert.equal(startedByLabel(undefined), 'Forecast script');
  });
});
