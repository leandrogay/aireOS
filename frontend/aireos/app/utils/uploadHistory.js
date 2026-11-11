import { matchesSearch } from './tableView.js';

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

// The Status column's ascending order: what needs someone to act on it
// first (a failed nomenclature, a review, a load or reload waiting), then
// what is done. Keys are mapping_status values, plus `rolled_back` for an
// upload whose load was reversed; anything not listed sorts last.
const STATUS_SORT_ORDER = [
  'mapping_failed',
  'pending_confirmation',
  'partial_match',
  'ready_to_load',
  'reload_available',
  'mapped',
  'rolled_back',
];

function statusRank(upload) {
  const key = upload.status === 'rolled_back' ? 'rolled_back' : upload.mapping_status;
  const rank = STATUS_SORT_ORDER.indexOf(key);
  return rank === -1 ? STATUS_SORT_ORDER.length : rank;
}

// `uploaded_at` is an ISO UTC instant, so comparing the strings orders them in
// time; a missing one sorts as the oldest.
function compareUploadedAt(a, b) {
  return String(a.uploaded_at || '').localeCompare(String(b.uploaded_at || ''));
}

/**
 * Uploads in the order Recent uploads' sortable columns ask for: `status`
 * (STATUS_SORT_ORDER, uploads with the same status newest first whichever
 * way it runs) or `uploaded_at`.
 *
 * @param {object[]} uploads
 * @param {{ field: 'status' | 'uploaded_at', direction: 'asc' | 'desc' }} sort
 * @returns {object[]}
 */
export function sortUploads(uploads, sort) {
  const sign = sort.direction === 'asc' ? 1 : -1;
  if (sort.field === 'status') {
    return [...uploads].sort((a, b) => sign * (statusRank(a) - statusRank(b)) || compareUploadedAt(b, a));
  }
  return [...uploads].sort((a, b) => sign * compareUploadedAt(a, b));
}

/**
 * The status badge an upload shows: Rolled back once its load was reversed,
 * else its mapping status's label, else the raw status in a neutral badge.
 *
 * @param {object} upload GET /api/uploads/history row
 * @returns {{ tone: string, label: string }}
 */
export function uploadStatus(upload) {
  if (upload.status === 'rolled_back') return ROLLED_BACK_STATUS;
  return UPLOAD_STATUS_LABELS[upload.mapping_status]
    || { tone: 'neutral', label: upload.mapping_status || 'Unknown' };
}

/**
 * Why an upload can't be deleted yet, or null when it can. A load still
 * running has to finish, and data still in sell-out has to be rolled back
 * first, so deleting the file never leaves rows without their source (backend
 * DELETE /api/uploads/source refuses the same cases).
 *
 * @param {object} upload GET /api/uploads/history row
 * @returns {string | null}
 */
export function deleteBlockedReason(upload) {
  if (upload.status === 'processing') return 'Wait for this load to finish';
  const hasActiveLoad = upload.status !== 'rolled_back' && (
    upload.rollback_available
    || ['mapped', 'reload_available'].includes(upload.mapping_status)
  );
  return hasActiveLoad ? 'Rollback this upload first' : null;
}
