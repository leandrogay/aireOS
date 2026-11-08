// What a file in flight shows while POST /api/uploads works on it, as pure
// functions. The endpoint answers once, at the end, so only sending the bytes
// has a real percentage. The server's share is an estimate that keeps moving
// and slows as it nears the end, so the bar never stalls and never claims to
// be done before the response lands. How long to expect comes from the
// pre-upload check (backend upload_check.check_file): a saved nomenclature
// applies in seconds, a new layout waits on Gemini.

/** Share of the bar that sending the file fills; the server's work fills the rest. */
export const SEND_SHARE = 30;

/** The estimate never passes this, so only the real response reaches 100%. */
export const CREEP_CEILING = 95;

/** Past this (or past the expected wait, if longer) the row says it is still working. */
export const STILL_WORKING_MS = 8000;

/** How long a full bar shows before the result replaces it. */
export const FINISH_PAUSE_MS = 300;

const SAVED_LAYOUT_MS = 4000;
const AI_LAYOUT_MS = 20000;
const UNKNOWN_LAYOUT_MS = 8000;

/**
 * How long the server's part should take for this file, and what to call it.
 * near_match goes through the same Gemini proposal as a new layout.
 *
 * @param {object | null | undefined} check FileCheck from uploadFlow.checkFromResult
 * @returns {{ expectedMs: number, label: string, hint: string | null }}
 */
export function waitExpectation(check) {
  const status = check?.mapping?.status;
  if (status === 'mapped') {
    return { expectedMs: SAVED_LAYOUT_MS, label: 'Applying the saved nomenclature', hint: null };
  }
  if (status === 'new_layout' || status === 'partial_match') {
    return {
      expectedMs: AI_LAYOUT_MS,
      label: 'Drafting a nomenclature with AI',
      hint: 'This usually takes about 20 seconds.',
    };
  }
  return { expectedMs: UNKNOWN_LAYOUT_MS, label: 'Processing file', hint: null };
}

/**
 * What the pre-upload check already settled, shown straight away rather than
 * as steps to wait through. A check that failed settled nothing.
 *
 * @param {object | null | undefined} check
 * @returns {string[]}
 */
export function checkedFacts(check) {
  if (!check || check.failed || check.error) return [];
  const facts = [];
  if (!check.duplicate) facts.push('No duplicates');
  const { status, name } = check.mapping || {};
  if (status === 'mapped') facts.push(name ? `Matches ${name}` : 'Matches a saved nomenclature');
  if (status === 'partial_match') facts.push('Close to a saved nomenclature');
  if (status === 'new_layout') facts.push('New layout');
  return facts;
}

/**
 * The bar's width, 0-100. Sending fills SEND_SHARE; after that the estimate
 * covers about two thirds of what is left by the expected time and keeps
 * slowing towards CREEP_CEILING.
 *
 * @param {{ sendPercent?: number | null, serverElapsedMs?: number | null,
 *   expectedMs: number, finished?: boolean }} progress
 * @returns {number}
 */
export function uploadPercent({ sendPercent, serverElapsedMs, expectedMs, finished }) {
  if (finished) return 100;
  if (serverElapsedMs === null || serverElapsedMs === undefined) {
    return Math.round(((sendPercent || 0) * SEND_SHARE) / 100);
  }
  const share = 1 - Math.exp(-Math.max(0, serverElapsedMs) / expectedMs);
  return Math.round(SEND_SHARE + (CREEP_CEILING - SEND_SHARE) * share);
}

/**
 * Whether the wait has run long enough to say the upload has not frozen.
 *
 * @param {number | null | undefined} serverElapsedMs
 * @param {number} expectedMs
 */
export function isStillWorking(serverElapsedMs, expectedMs) {
  if (serverElapsedMs === null || serverElapsedMs === undefined) return false;
  return serverElapsedMs > Math.max(STILL_WORKING_MS, expectedMs * 1.5);
}
