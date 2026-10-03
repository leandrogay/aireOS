// The upload screen's file list, as pure functions: reading the pre-upload
// check and the upload response, what state each file is in, which section of
// the list it belongs to, and what (if anything) is holding the Upload button.

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
        // GCS contracts are addressed by their header fingerprint.
        mappingId: mapping.fingerprint,
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
 * @typedef {{
 *   contentHash: string | null,
 *   error: string | null,
 *   mapping: { status: 'mapped' | 'partial_match' | 'new_layout', name: string?, vendor: string?, matched: object? } | null,
 *   duplicate: { matchedOn: 'content' | 'filename', existingFilename: string?, uploadedAt: string? } | null,
 *   failed?: string,
 * }} FileCheck
 */

/**
 * Read one entry from POST /api/uploads/check (backend upload_check.check_file).
 * The duplicate uses the same field names as a 'duplicate' FileOutcome, so a
 * duplicate the upload itself reports can take its place.
 *
 * @param {object} result
 * @returns {FileCheck}
 */
export function checkFromResult(result) {
  const duplicate = result?.duplicate;
  return {
    contentHash: result?.content_hash || null,
    error: result?.error || null,
    mapping: result?.mapping
      ? {
          status: result.mapping.status,
          name: result.mapping.name || null,
          vendor: result.mapping.vendor || null,
          matched: result.mapping.matched || null,
        }
      : null,
    duplicate: duplicate
      ? {
          matchedOn: duplicate.matched_on || 'filename',
          existingFilename: duplicate.existing_filename || null,
          uploadedAt: duplicate.existing_uploaded_at || null,
        }
      : null,
  };
}

/**
 * What a file looks like before it is uploaded, from its check.
 *
 *   duplicate   an earlier upload matches; the person must choose what to do
 *   ready       a stored mapping matches exactly
 *   near_match  close to a stored mapping, but not exactly
 *   new_layout  no mapping yet; one is proposed for review after upload
 *   unchecked   the check itself failed; the upload checks again anyway
 *
 * @param {object} item
 */
function beforeUploadKind(item) {
  const { check } = item;
  if (check?.duplicate) return 'duplicate';
  if (!check?.mapping) return 'unchecked';
  if (check.mapping.status === 'mapped') return 'ready';
  if (check.mapping.status === 'partial_match') return 'near_match';
  if (check.mapping.status === 'new_layout') return 'new_layout';
  return 'unchecked';
}

/**
 * The one state a file row renders.
 *
 * @param {object} item
 * @returns {'checking' | 'uploading' | 'uploaded' | 'needs_review' | 'failed' |
 *   'duplicate' | 'ready' | 'near_match' | 'new_layout' | 'unchecked'}
 */
export function fileKind(item) {
  if (item.phase === 'checking') return 'checking';
  if (item.phase === 'uploading') return 'uploading';
  if (item.phase === 'done') {
    return item.outcome.kind === 'mapped' ? 'uploaded' : item.outcome.kind;
  }
  return beforeUploadKind(item);
}

// Sections of the list, top to bottom: what is fine first, what needs the
// person below it, most urgent first. One section per situation, so the
// explanation (`note`) is said once above the files it applies to rather
// than repeated on every row.
export const FILE_GROUPS = [
  { key: 'checking', label: 'Checking' },
  {
    key: 'ready',
    label: 'Ready to upload',
    note: 'These match a saved mapping, so their data loads as soon as they are uploaded.',
  },
  { key: 'uploaded', label: 'Uploaded' },
  {
    key: 'duplicate',
    label: 'Already uploaded',
    note: 'Choose whether each one replaces the earlier copy or is kept alongside it. To skip a file, remove it.',
  },
  {
    key: 'failed',
    label: "Didn't upload",
    note: 'Try again, or remove the file.',
  },
  {
    key: 'needs_review',
    label: 'Mapping to review',
    note: "Uploaded, but their data won't load until the mapping is reviewed.",
  },
  {
    key: 'near_match',
    label: 'Close to a saved mapping',
    note: "The columns differ slightly from a saved mapping. They will upload, but their data won't load until the mapping is checked.",
  },
  {
    key: 'new_layout',
    label: 'New layout',
    note: "No saved mapping fits these yet. They will upload, and you'll review a suggested mapping before their data loads.",
  },
  {
    key: 'unchecked',
    label: 'Not checked yet',
    note: "We couldn't check these in advance. They'll be checked when you upload.",
  },
];

/**
 * The section a file is listed under: its kind, except that a file being
 * uploaded stays where it was before the upload started, so rows do not jump
 * while they work; they move once, when the result is in.
 *
 * @param {object} item
 * @returns {string}
 */
export function fileGroup(item) {
  const kind = fileKind(item);
  return kind === 'uploading' ? beforeUploadKind(item) : kind;
}

/**
 * The list split into its non-empty sections, in FILE_GROUPS order. Within a
 * section files keep the order they were added in.
 *
 * @param {object[]} items
 * @returns {Array<{ key: string, label: string, note?: string, items: object[] }>}
 */
export function groupFiles(items) {
  return FILE_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => fileGroup(item) === group.key),
  })).filter((group) => group.items.length);
}

/**
 * Whether pressing Upload sends this file now: checked, not yet sent, and, if
 * it duplicates an earlier upload, with a decision made.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isUploadable(item) {
  return item.phase === 'ready' && (!item.check?.duplicate || Boolean(item.decision));
}

/**
 * The uploadFile() flags for a file: a duplicate decision becomes `force`
 * (replace the earlier copy) or `keepDuplicate` (keep both).
 *
 * @param {object} item
 * @returns {{ force?: boolean, keepDuplicate?: boolean }}
 */
export function uploadOptionsFor(item) {
  if (item.decision === 'replace') return { force: true };
  if (item.decision === 'keep') return { keepDuplicate: true };
  return {};
}

/**
 * Why Upload cannot be pressed yet, or '' when nothing is in the way. Files
 * still being checked and duplicates without a decision hold it; a duplicate
 * the person does not want is one click away (its remove button).
 *
 * @param {object[]} items
 * @returns {string}
 */
export function uploadBlocker(items) {
  const checking = items.filter((item) => item.phase === 'checking').length;
  if (checking) return `Checking ${checking} file${checking === 1 ? '' : 's'}…`;

  const undecided = items.filter(
    (item) => item.phase === 'ready' && item.check?.duplicate && !item.decision,
  ).length;
  if (undecided) {
    return undecided === 1
      ? 'Choose what to do with the file that was already uploaded.'
      : `Choose what to do with the ${undecided} files that were already uploaded.`;
  }

  return '';
}
