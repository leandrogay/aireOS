// Reading a Recent uploads row (backend GET /api/uploads/history): its status
// badge, whether it can be deleted yet, and the table's sort.
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { deleteBlockedReason, sortUploads, uploadStatus } from '../app/utils/uploadHistory.js';

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

// ---- sortUploads ----

function upload(name, mappingStatus, uploadedAt, status = 'completed') {
  return { filename: name, mapping_status: mappingStatus, uploaded_at: uploadedAt, status };
}

const names = (uploads) => uploads.map((item) => item.filename);

describe('sortUploads', () => {
  const uploads = [
    upload('loaded', 'mapped', '2026-11-01T00:00:00Z'),
    upload('rolled-back', 'mapped', '2026-11-02T00:00:00Z', 'rolled_back'),
    upload('unknown', 'something_new', '2026-11-03T00:00:00Z'),
    upload('waiting', 'ready_to_load', '2026-11-04T00:00:00Z'),
    upload('review', 'pending_confirmation', '2026-11-05T00:00:00Z'),
    upload('failed', 'mapping_failed', '2026-11-06T00:00:00Z'),
    upload('reload', 'reload_available', '2026-11-07T00:00:00Z'),
  ];

  test('status ascending puts what needs acting on first and unknown statuses last', () => {
    assert.deepEqual(names(sortUploads(uploads, { field: 'status', direction: 'asc' })), [
      'failed', 'review', 'waiting', 'reload', 'loaded', 'rolled-back', 'unknown',
    ]);
  });

  test('status descending reverses the status order', () => {
    assert.deepEqual(names(sortUploads(uploads, { field: 'status', direction: 'desc' })), [
      'unknown', 'rolled-back', 'loaded', 'reload', 'waiting', 'review', 'failed',
    ]);
  });

  test('uploads with the same status are newest first either way', () => {
    const sameStatus = [
      upload('older', 'mapped', '2026-11-01T00:00:00Z'),
      upload('newer', 'mapped', '2026-11-09T00:00:00Z'),
    ];
    assert.deepEqual(names(sortUploads(sameStatus, { field: 'status', direction: 'asc' })), ['newer', 'older']);
    assert.deepEqual(names(sortUploads(sameStatus, { field: 'status', direction: 'desc' })), ['newer', 'older']);
  });

  test('uploaded_at sorts by time, a missing time as the oldest', () => {
    const timed = [
      upload('middle', 'mapped', '2026-11-05T00:00:00Z'),
      upload('none', 'mapped', null),
      upload('latest', 'mapped', '2026-11-09T00:00:00Z'),
    ];
    assert.deepEqual(names(sortUploads(timed, { field: 'uploaded_at', direction: 'desc' })), ['latest', 'middle', 'none']);
    assert.deepEqual(names(sortUploads(timed, { field: 'uploaded_at', direction: 'asc' })), ['none', 'middle', 'latest']);
  });

  test('does not reorder the list it was given', () => {
    const copy = [...uploads];
    sortUploads(uploads, { field: 'status', direction: 'asc' });
    assert.deepEqual(uploads, copy);
  });
});
