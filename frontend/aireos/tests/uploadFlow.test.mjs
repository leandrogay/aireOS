// Reading the upload endpoint's per-file result (backend routers/uploads.py).
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { outcomeFromResult } from '../app/utils/uploadFlow.js';

describe('outcomeFromResult', () => {
  test('a new layout proposed by the model needs review with no AI warning', () => {
    const outcome = outcomeFromResult({
      success: true,
      mapping: { status: 'pending_confirmation', fingerprint: 'fp1', ai_unavailable: null },
    });

    assert.deepEqual(outcome, { kind: 'needs_review', why: 'new', mappingId: 'fp1', matched: null, aiUnavailable: null });
  });

  test('a blank proposal made while the model was unavailable carries the message', () => {
    const message = "The AI model gemini-old is no longer available. It's used by Nomenclature generation.";

    const outcome = outcomeFromResult({
      success: true,
      mapping: { status: 'pending_confirmation', fingerprint: 'fp1', source: 'manual', ai_unavailable: message },
    });

    assert.equal(outcome.kind, 'needs_review');
    assert.equal(outcome.aiUnavailable, message);
  });
});
