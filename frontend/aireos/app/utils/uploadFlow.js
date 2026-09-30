// Turning one upload response into something a file row can render, and a
// batch of them into the summary line above the results.

/**
 * The stages a file passes through on the server, in order.
 *
 * POST /api/uploads does all three in one synchronous call and answers once at
 * the end, so there is no progress to subscribe to — the labels advance on a
 * timer while the request is in flight, and the last one is replaced by the
 * real outcome when the response lands. The order and the names are the work
 * the server actually does, in the order it does it; only the timing is a
 * guess. If the endpoint ever grows per-file job status, this is the one place
 * that has to change.
 */
export const STAGES = [
  { key: 'uploading', label: 'Uploading', afterMs: 0 },
  { key: 'duplicates', label: 'Checking for duplicates', afterMs: 700 },
  { key: 'matching', label: 'Matching mapping', afterMs: 1800 },
];

/**
 * @typedef {(
 *   | { kind: 'mapped', mappingId: string, name: string?, vendor: string?, processing: object? }
 *   | { kind: 'needs_review', why: 'new' | 'partial', mappingId: string?, matched: object? }
 *   | { kind: 'duplicate', matchedOn: 'content' | 'filename', existingFilename: string?, uploadedAt: string? }
 *   | { kind: 'failed', error: string }
 * )} FileOutcome
 */

/**
 * Read one entry from the upload endpoint's `results` array.
 *
 * @param {object} result
 * @returns {FileOutcome}
 */
export function outcomeFromResult(result) {
  if (result?.reason === 'duplicate') {
    return {
      kind: 'duplicate',
      matchedOn: result.duplicate_of || 'filename',
      existingFilename: result.existing_filename || null,
      uploadedAt: result.existing_uploaded_at || null,
    };
  }

  if (!result?.success) {
    return { kind: 'failed', error: result?.error || 'Upload failed.' };
  }

  const mapping = result.mapping;
  if (!mapping) {
    return {
      kind: 'failed',
      error: 'The file uploaded, but the server returned no mapping result for it.',
    };
  }

  switch (mapping.status) {
    case 'mapped':
      return {
        kind: 'mapped',
        // A contract is keyed by fingerprint; the built-in FairPrice rules are
        // keyed by their mapping id instead. Either addresses /mappings/[id].
        mappingId: mapping.fingerprint || mapping.mapping_id,
        name: mapping.name || null,
        vendor: mapping.vendor || null,
        processing: mapping.processing || null,
      };

    case 'partial_match':
      return {
        kind: 'needs_review',
        why: 'partial',
        mappingId: mapping.matched?.fingerprint || null,
        matched: mapping.matched || null,
      };

    case 'pending_confirmation':
      return { kind: 'needs_review', why: 'new', mappingId: mapping.fingerprint, matched: null };

    default:
      return {
        kind: 'failed',
        error: mapping.error || 'The file uploaded, but no mapping could be produced.',
      };
  }
}

/**
 * The line above the results, e.g.
 * "7 processed · 2 need review · 1 duplicate · 1 failed".
 *
 * Counts that are zero are left out rather than shown as "0 failed", so the
 * line says what happened instead of listing what didn't.
 */
export function summariseOutcomes(items) {
  // A skipped duplicate was never processed, so it is not counted as one. Its
  // own row says "Skipped", which is the whole of what happened to it.
  const finished = items.filter(
    (item) => item.outcome && item.outcome.kind !== 'skipped',
  );
  if (!finished.length) return '';

  const count = (kind) => finished.filter((item) => item.outcome.kind === kind).length;

  const parts = [`${finished.length} processed`];
  const needsReview = count('needs_review');
  const duplicates = count('duplicate');
  const failed = count('failed');

  if (needsReview) parts.push(`${needsReview} need${needsReview === 1 ? 's' : ''} review`);
  if (duplicates) parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
  if (failed) parts.push(`${failed} failed`);

  return parts.join(' · ');
}
