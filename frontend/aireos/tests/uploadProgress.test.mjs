// The upload progress bar's estimate, wording and early facts
// (app/utils/uploadProgress.js). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CREEP_CEILING,
  SEND_SHARE,
  STILL_WORKING_MS,
  checkedFacts,
  isStillWorking,
  uploadPercent,
  waitExpectation,
} from '../app/utils/uploadProgress.js';

const SAVED = { mapping: { status: 'mapped', name: 'FairPrice monthly' }, duplicate: null };
const NEW = { mapping: { status: 'new_layout', name: null }, duplicate: null };

// ---- uploadPercent ----

describe('uploadPercent', () => {
  test('sending fills only the send share of the bar', () => {
    assert.equal(uploadPercent({ sendPercent: 0, expectedMs: 4000 }), 0);
    assert.equal(uploadPercent({ sendPercent: 100, expectedMs: 4000 }), SEND_SHARE);
  });

  test('the server part starts where sending stopped, so the bar never goes back', () => {
    assert.equal(uploadPercent({ serverElapsedMs: 0, expectedMs: 4000 }), SEND_SHARE);
  });

  test('the estimate keeps growing but never reaches the ceiling', () => {
    const early = uploadPercent({ serverElapsedMs: 2000, expectedMs: 4000 });
    const late = uploadPercent({ serverElapsedMs: 8000, expectedMs: 4000 });
    const forever = uploadPercent({ serverElapsedMs: 10 * 60 * 1000, expectedMs: 4000 });
    assert.ok(early < late);
    assert.ok(late < CREEP_CEILING);
    assert.equal(forever, CREEP_CEILING);
  });

  test('a longer expected wait moves the bar more slowly', () => {
    const saved = uploadPercent({ serverElapsedMs: 3000, expectedMs: 4000 });
    const ai = uploadPercent({ serverElapsedMs: 3000, expectedMs: 20000 });
    assert.ok(ai < saved);
  });

  test('only the response fills the bar', () => {
    assert.equal(uploadPercent({ serverElapsedMs: 100, expectedMs: 4000, finished: true }), 100);
  });
});

// ---- waitExpectation ----

describe('waitExpectation', () => {
  test('a saved nomenclature is expected to be quicker than an AI draft', () => {
    assert.ok(waitExpectation(SAVED).expectedMs < waitExpectation(NEW).expectedMs);
  });

  test('a new layout or near match says the AI is drafting and how long it takes', () => {
    for (const status of ['new_layout', 'partial_match']) {
      const wait = waitExpectation({ mapping: { status } });
      assert.match(wait.label, /AI/);
      assert.match(wait.hint, /20 seconds/);
    }
  });

  test('a failed or missing check falls back to a neutral label', () => {
    assert.equal(waitExpectation(null).label, 'Processing file');
    assert.equal(waitExpectation({ failed: 'Network down' }).hint, null);
  });
});

// ---- checkedFacts ----

describe('checkedFacts', () => {
  test('a clean saved-layout check names the nomenclature it matches', () => {
    assert.deepEqual(checkedFacts(SAVED), ['No duplicates', 'Matches FairPrice monthly']);
  });

  test('a file uploaded despite a duplicate does not claim to have none', () => {
    const facts = checkedFacts({ ...NEW, duplicate: { matchedOn: 'content' } });
    assert.deepEqual(facts, ['New layout']);
  });

  test('a failed check settles nothing', () => {
    assert.deepEqual(checkedFacts({ failed: 'Network down' }), []);
    assert.deepEqual(checkedFacts(null), []);
  });
});

// ---- isStillWorking ----

describe('isStillWorking', () => {
  test('a quick file says nothing until the threshold passes', () => {
    assert.equal(isStillWorking(STILL_WORKING_MS - 1, 4000), false);
    assert.equal(isStillWorking(STILL_WORKING_MS + 1, 4000), true);
  });

  test('an AI draft is not called slow before its expected wait has run over', () => {
    assert.equal(isStillWorking(20000, 20000), false);
    assert.equal(isStillWorking(31000, 20000), true);
  });

  test('nothing is said while the file is still sending', () => {
    assert.equal(isStillWorking(null, 4000), false);
  });
});
