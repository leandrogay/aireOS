// Pure helpers for the DOH settings page: form validation, payloads and
// display formatting. No React in here. Payload field names mirror
// DohThresholdsUpdate in backend app/schemas/settings/doh.py; change them
// together.

// ============================================================
// Global default
// ============================================================

// Mirrors GLOBAL_DEFAULT_*_DOH in backend app/services/settings/doh.py. Only
// used for the explanatory text: the values in each row always come from the
// backend, which fills them in for customers without thresholds of their own.
export const GLOBAL_DEFAULT_DOH = { min: 25, target: 30, max: 35 };

// ============================================================
// Threshold form
// ============================================================

// The backend stores NUMERIC(6,2), so anything above this would be rejected.
const MAX_DOH_DAYS = 9999;

export const EMPTY_DOH_THRESHOLD_FORM = { minDoh: '', targetDoh: '', maxDoh: '' };

export const DOH_THRESHOLD_FIELDS = [
  { name: 'minDoh', label: 'Min DOH' },
  { name: 'targetDoh', label: 'Target DOH' },
  { name: 'maxDoh', label: 'Max DOH' },
];

/**
 * @param {{ min_doh: number, target_doh: number, max_doh: number }} settings a row from getDohSettings
 * @returns {{ minDoh: string, targetDoh: string, maxDoh: string }}
 */
export function formFromDohSettings(settings) {
  return {
    minDoh: String(settings.min_doh),
    targetDoh: String(settings.target_doh),
    maxDoh: String(settings.max_doh),
  };
}

/**
 * @param {string} value
 * @returns {string | null} the message for one field on its own, or null when it is fine
 */
function fieldError(value) {
  const text = value.trim();
  if (text === '') return 'Required.';
  if (!/^\d+$/.test(text)) return 'Enter a whole number of 0 or more.';
  if (Number(text) > MAX_DOH_DAYS) return `Must be ${MAX_DOH_DAYS} or less.`;
  return null;
}

/**
 * Checks each field on its own (whole number, 0 or more), then the order
 * min <= target <= max, putting each message on the field that has to change.
 *
 * @param {{ minDoh: string, targetDoh: string, maxDoh: string }} form
 * @returns {Record<string, string>} field name -> message; empty when valid
 */
export function validateDohThresholdForm(form) {
  const errors = {};

  for (const { name } of DOH_THRESHOLD_FIELDS) {
    const message = fieldError(form[name]);
    if (message) errors[name] = message;
  }

  const min = Number(form.minDoh);
  const target = Number(form.targetDoh);
  const max = Number(form.maxDoh);

  if (!errors.minDoh && !errors.targetDoh && min > target) {
    errors.minDoh = 'Min DOH cannot be more than Target DOH.';
  }
  if (!errors.targetDoh && !errors.maxDoh && target > max) {
    errors.maxDoh = 'Max DOH cannot be less than Target DOH.';
  }

  return errors;
}

/**
 * @param {{ minDoh: string, targetDoh: string, maxDoh: string }} form a form that passed validateDohThresholdForm
 * @returns {{ min_doh: number, target_doh: number, max_doh: number }}
 */
export function buildDohThresholdPayload(form) {
  return {
    min_doh: Number(form.minDoh),
    target_doh: Number(form.targetDoh),
    max_doh: Number(form.maxDoh),
  };
}

// ============================================================
// Display formatting
// ============================================================

/**
 * @param {number | null | undefined} value days
 * @returns {string} '30' or '30.5' (the backend allows 2 decimal places), or a dash
 */
export function formatDohDays(value) {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/**
 * @param {string | null} isoTimestamp
 * @returns {string} e.g. '24 Sep 2026, 00:50', or a dash
 */
export function formatTimestamp(isoTimestamp) {
  if (!isoTimestamp) return '—';
  return new Date(isoTimestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
