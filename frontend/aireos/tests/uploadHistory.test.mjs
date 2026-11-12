// Reading a Recent uploads row (backend GET /api/uploads/history): its status
// badge and whether it can be deleted yet.
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { deleteBlockedReason, uploadStatus } from '../app/utils/uploadHistory.js';

// ---- uploadStatus ----

describe('uploadStatus', () => {
  test('a rolled back upload reads Rolled back whatever its mapping status', () => {
    assert.deepEqual(uploadStatus({ status: 'rolled_back', mapping_status: 'mapped' }), {
      tone: 'neutral',
      label: 'Rolled back',
    });
  });

  test('a known mapping status uses its label and tone', () => {
    assert.deepEqual(uploadStatus({ status: 'completed', mapping_status: 'ready_to_load' }), {
      tone: 'review',
      label: 'Approved, not loaded',
    });
  });

  test('an unknown mapping status shows the raw value in a neutral badge', () => {
    assert.deepEqual(uploadStatus({ mapping_status: 'something_new' }), { tone: 'neutral', label: 'something_new' });
  });

  test('no mapping status reads Unknown', () => {
    assert.deepEqual(uploadStatus({}), { tone: 'neutral', label: 'Unknown' });
  });
});

// ---- deleteBlockedReason ----

describe('deleteBlockedReason', () => {
  test('a load still running blocks the delete', () => {
    assert.equal(deleteBlockedReason({ status: 'processing', mapping_status: 'mapped' }), 'Wait for this load to finish');
  });

  test('a loaded upload must be rolled back first', () => {
    assert.equal(deleteBlockedReason({ status: 'completed', mapping_status: 'mapped' }), 'Rollback this upload first');
  });

  test('an upload with an older version loaded must be rolled back first', () => {
    assert.equal(deleteBlockedReason({ mapping_status: 'reload_available' }), 'Rollback this upload first');
  });

  test('an upload that can still be rolled back must be rolled back first', () => {
    assert.equal(deleteBlockedReason({ mapping_status: 'ready_to_load', rollback_available: true }), 'Rollback this upload first');
  });

  test('a rolled back upload can be deleted', () => {
    assert.equal(deleteBlockedReason({ status: 'rolled_back', mapping_status: 'mapped' }), null);
  });

  test('an upload never loaded can be deleted', () => {
    assert.equal(deleteBlockedReason({ mapping_status: 'pending_confirmation' }), null);
  });
});
