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
  { key: 'matching', label: 'Processing file', afterMs: 1800 },
];

/**
 * @typedef {(
 *   | { kind: 'mapped', mappingId: string, name: string?, vendor: string?, processing: object? }
 *   | { kind: 'ready_to_load', mappingId: string, name: string?, vendor: string?, blobPath: string }
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
      error: 'The file uploaded, but the server returned no nomenclature result for it.',
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

    // REQUIRE_LOAD_CONFIRMATION is on: matched to an approved mapping, but
    // nothing loaded until a person confirms it (backend upload_loading).
    case 'ready_to_load':
      return {
        kind: 'ready_to_load',
        mappingId: mapping.fingerprint,
        name: mapping.name || null,
        vendor: mapping.vendor || null,
        blobPath: result.blob_path,
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
        error: mapping.error || 'The file uploaded, but no nomenclature could be produced.',
      };
  }
}

/**
 * @typedef {{
 *   contentHash: string | null,
 *   error: string | null,
 *   mapping: { status: 'mapped' | 'partial_match' | 'new_layout', name: string?, vendor: string?, matched: object? } | null,
 *   duplicate: { matchedOn: 'content' | 'filename', existingFilename: string?, uploadedAt: string? } | null,
 *   loadRequiresConfirmation: boolean,
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
    loadRequiresConfirmation: Boolean(result?.load_requires_confirmation),
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
 * @returns {'checking' | 'uploading' | 'uploaded' | 'ready_to_load' | 'needs_review' |
 *   'failed' | 'duplicate' | 'ready' | 'near_match' | 'new_layout' | 'unchecked'}
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
    note: 'These match a saved nomenclature, so their data loads as soon as they are uploaded.',
    // With REQUIRE_LOAD_CONFIRMATION on (said by the check), uploading does
    // not load them, and the note must not promise it does.
    confirmNote: "These match a saved nomenclature. After uploading, you'll check what loading them would change before their data loads.",
  },
  { key: 'uploaded', label: 'Uploaded' },
  {
    key: 'ready_to_load',
    label: 'Ready to load',
    note: "Uploaded and matched to an approved nomenclature. Their data isn't loaded until you check and load it.",
  },
  {
    key: 'duplicate',
    label: 'Already uploaded',
    note: 'Choose for each one: replace the earlier copy, keep both, or skip it.',
  },
  {
    key: 'failed',
    label: "Didn't upload",
    note: 'Try again, or remove the file.',
  },
  {
    key: 'needs_review',
    label: 'Nomenclature to review',
    note: "Uploaded, but their data won't load until the nomenclature is reviewed.",
  },
  {
    key: 'near_match',
    label: 'Close to a saved nomenclature',
    note: "The columns differ slightly from a saved nomenclature. They will upload, but their data won't load until the nomenclature is checked.",
  },
  {
    key: 'new_layout',
    label: 'New layout',
    note: "No saved nomenclature fits these yet. They will upload, and you'll review a suggested nomenclature before their data loads.",
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
  return FILE_GROUPS.map(({ confirmNote, ...group }) => {
    const members = items.filter((item) => fileGroup(item) === group.key);
    const confirming = members.some((item) => item.check?.loadRequiresConfirmation);
    return { ...group, note: confirming && confirmNote ? confirmNote : group.note, items: members };
  }).filter((group) => group.items.length);
}

/**
 * The files a button acts on: "file" for one ("Upload file"), "3 files" for
 * more. Buttons only -- a sentence keeps its count ("1 file is waiting").
 *
 * @param {number} count
 * @returns {string}
 */
export function filesLabel(count) {
  return count === 1 ? 'file' : `${count.toLocaleString()} files`;
}

/**
 * What happens to a duplicate on Upload: the person's choice, else the likely
 * one. The same contents are already uploaded, so sending them again changes
 * nothing: skip. Only the name matches, so it is usually a corrected
 * re-export: replace the earlier copy. Null for a file that duplicates
 * nothing, so it is never sent with `force` (which would skip the server's
 * own duplicate check).
 *
 * @param {object} item
 * @returns {'replace' | 'keep' | 'skip' | null}
 */
export function duplicateDecision(item) {
  const duplicate = item.check?.duplicate;
  if (!duplicate) return null;
  return item.decision || (duplicate.matchedOn === 'content' ? 'skip' : 'replace');
}

/**
 * What the current duplicate decision will do, to the file and to sales data,
 * said under the choice. Replace uploads with `force`: the earlier blob is
 * deleted (storage.upload_file) and, when the file loads, the rows from a file
 * of that name are deleted before its own are written (replace_source in
 * sellout_service.load_clean_rows). Keep both only upserts. A file loads on
 * upload only when it matches an approved mapping and loading needs no
 * confirmation; otherwise the earlier rows stay until it is loaded.
 *
 * @param {object} item
 * @returns {string}
 */
export function duplicateResult(item) {
  const decision = duplicateDecision(item);
  if (decision === 'skip') return 'Not uploaded. Nothing changes.';
  if (decision === 'keep') return "Both kept. Where they overlap, this file's figures are used.";
  const loadsOnUpload = item.check?.mapping?.status === 'mapped' && !item.check.loadRequiresConfirmation;
  return loadsOnUpload
    ? "Earlier copy deleted. Its sales figures are replaced by this file's."
    : 'Earlier copy deleted. Its sales figures stay until this file is loaded.';
}

/**
 * Whether pressing Upload sends this file now: checked, not yet sent, and not
 * a duplicate set to Skip.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isUploadable(item) {
  return item.phase === 'ready' && duplicateDecision(item) !== 'skip';
}

/**
 * The uploadFile() flags for a file: a duplicate decision becomes `force`
 * (replace the earlier copy) or `keepDuplicate` (keep both). A skipped file
 * is never sent (isUploadable).
 *
 * @param {object} item
 * @returns {{ force?: boolean, keepDuplicate?: boolean }}
 */
export function uploadOptionsFor(item) {
  const decision = duplicateDecision(item);
  if (decision === 'replace') return { force: true };
  if (decision === 'keep') return { keepDuplicate: true };
  return {};
}

/**
 * Why Upload cannot be pressed yet, or '' when nothing is in the way. Only
 * files still being checked hold it: a duplicate always has a decision (see
 * duplicateDecision), Skip among them.
 *
 * @param {object[]} items
 * @returns {string}
 */
export function uploadBlocker(items) {
  const checking = items.filter((item) => item.phase === 'checking').length;
  if (checking) return `Checking ${checking} file${checking === 1 ? '' : 's'}…`;
  return '';
}
