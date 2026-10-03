import { matchesSearch } from '@/app/utils/tableView';

// The mapping status recorded on each blob at upload time, as something a
// person reads. Anything unrecognised falls through to the raw value rather
// than being hidden. Keys are backend storage.list_uploads mapping_status.
export const UPLOAD_STATUS_LABELS = {
  mapped: { tone: 'ready', label: 'Mapped' },
  pending_confirmation: { tone: 'review', label: 'Needs review' },
  partial_match: { tone: 'review', label: 'Needs review' },
  mapping_failed: { tone: 'failed', label: 'Mapping failed' },
};

/**
 * Uploads whose file name, vendor or mapping name contains the query.
 *
 * @param {object[]} uploads GET /api/uploads/history rows
 * @param {string} query
 * @returns {object[]}
 */
export function searchUploads(uploads, query) {
  return uploads.filter((upload) =>
    matchesSearch([upload.filename, upload.vendor, upload.mapping_name], query),
  );
}

/**
 * Uploads ordered by when they were uploaded. `uploaded_at` is an ISO UTC
 * instant, so comparing the strings orders them in time; a missing one sorts
 * as the oldest.
 *
 * @param {object[]} uploads
 * @param {'asc' | 'desc'} direction
 * @returns {object[]}
 */
export function sortUploadsByDate(uploads, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return [...uploads].sort(
    (a, b) => sign * String(a.uploaded_at || '').localeCompare(String(b.uploaded_at || '')),
  );
}
