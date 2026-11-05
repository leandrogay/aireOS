import { matchesSearch } from '@/app/utils/tableView';

// The mapping status recorded on each blob, as something a person reads.
// Anything unrecognised falls through to the raw value rather than being
// hidden. Keys are backend storage.list_uploads mapping_status; the load
// states are backend upload_loading (`mapped` means loaded, and kept its name
// so uploads stamped before loading was its own step still read right).
export const UPLOAD_STATUS_LABELS = {
  mapped: { tone: 'ready', label: 'Loaded' },
  ready_to_load: { tone: 'review', label: 'Approved, not loaded' },
  reload_available: { tone: 'review', label: 'Older version loaded' },
  pending_confirmation: { tone: 'review', label: 'Needs review' },
  partial_match: { tone: 'review', label: 'Needs review' },
  mapping_failed: { tone: 'failed', label: 'Nomenclature failed' },
};

export const ROLLED_BACK_STATUS = { tone: 'neutral', label: 'Rolled back' };

/**
 * The load an upload is waiting for, if any: a first load once its mapping
 * is approved, or a reload after a new version. Null for every other state.
 *
 * @param {object} upload GET /api/uploads/history row
 * @returns {{ label: string, reload: boolean } | null}
 */
export function loadActionFor(upload) {
  if (upload.mapping_status === 'ready_to_load') return { label: 'Load', reload: false };
  if (upload.mapping_status === 'reload_available') return { label: 'Reload', reload: true };
  return null;
}

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
