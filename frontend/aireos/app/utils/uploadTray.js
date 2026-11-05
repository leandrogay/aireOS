// The upload tray's contents, as pure functions: which files it shows and how
// its header sums them up. No React in here.

import { fileKind } from '@/app/utils/uploadFlow';

/**
 * Which upload of a file a tray row is about. Closing the tray hides this
 * upload only, so sending the file again brings its row back.
 *
 * @param {object} item
 * @returns {string}
 */
export function trayRowKey(item) {
  return `${item.id}:${item.uploadRun || 0}`;
}

/**
 * The files the tray shows: ones sent to the server, not ones still waiting on
 * the upload page, less any the person closed. A file the server sent back as
 * a duplicate stays, since it still needs an answer.
 *
 * @param {object[]} items
 * @param {Set<string>} closedKeys rows closed with the tray's close button
 * @returns {object[]}
 */
export function trayItems(items, closedKeys) {
  return items.filter((item) => {
    const sent = item.phase === 'uploading' || item.phase === 'done' || item.sentBack;
    return sent && !closedKeys.has(trayRowKey(item));
  });
}

/**
 * @param {object[]} rows from trayItems
 * @returns {string} e.g. "Uploading 2 of 3 files", "2 uploaded, 1 failed"
 */
export function trayTitle(rows) {
  const total = rows.length;
  const inFlight = rows.filter((item) => item.phase === 'uploading').length;
  if (inFlight) return `Uploading ${inFlight} of ${total} ${total === 1 ? 'file' : 'files'}`;

  const failed = rows.filter((item) => fileKind(item) === 'failed').length;
  const skipped = rows.filter((item) => fileKind(item) === 'skipped').length;
  const finished = total - failed - skipped;
  // A skipped duplicate was never sent, so it is not counted as an upload.
  const parts = [];
  if (finished) parts.push(`${finished} ${finished === 1 ? 'upload' : 'uploads'} finished`);
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(', ');
}

/**
 * What a finished row says about its file.
 *
 * @param {object} item a tray row that is no longer in flight
 * @returns {string}
 */
export function trayStatus(item) {
  const kind = fileKind(item);
  if (kind === 'failed') return item.outcome.error;
  if (kind === 'ready_to_load') return 'Uploaded, not loaded yet';
  if (kind === 'duplicate') return 'Already uploaded. Choose what to do with it.';
  if (kind === 'skipped') return 'Skipped: already uploaded';
  if (kind === 'needs_review') {
    return item.outcome.why === 'partial' ? 'Close to a saved nomenclature' : 'Needs a nomenclature';
  }
  const processing = item.outcome?.processing;
  if (processing?.storage_status === 'completed') {
    return `${(processing.rows_stored || 0).toLocaleString()} rows loaded`;
  }
  return 'Uploaded';
}
