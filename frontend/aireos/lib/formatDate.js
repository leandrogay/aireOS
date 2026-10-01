// Display formatting for dates and timestamps, shared by every page (the
// date-range counterpart is formatDateRange.js next to this file).
//
// One unambiguous style everywhere: day, short month name, 4-digit year
// ("6 Sep 2026"), and 24-hour time for timestamps ("6 Sep 2026, 17:21").
// A month name cannot be misread the way 06/09 can (6 Sep vs Jun 9), and the
// year is always shown so tables that span years stay clear.
//
// Built from fixed month names rather than Intl: current ICU prints "Sept" for
// en-GB/en-SG while older browsers print "Sep", and the same text should come
// out on every browser (and on the server, if one of these ever renders there).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A bare calendar date as the API sends it (YYYY-MM-DD, nothing after it).
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const EMPTY = '—';

function datePart(year, monthIndex, day) {
  return `${day} ${MONTHS[monthIndex]} ${year}`;
}

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/**
 * @param {string | Date} value
 * @returns {Date | null} null when the value is not a real date
 */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A calendar date, e.g. `'2026-09-06'` → `'6 Sep 2026'`.
 *
 * A bare `YYYY-MM-DD` is shown as written, never shifted by timezone
 * (`new Date('2026-09-06')` is UTC midnight, which is 5 Sep west of UTC). A full
 * timestamp or Date is shown as the viewer's local calendar date.
 *
 * @param {string | Date | null | undefined} value
 * @returns {string} the formatted date, '—' when empty, or the value as given when it is not a date
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') return EMPTY;

  const match = typeof value === 'string' ? DATE_ONLY.exec(value.trim()) : null;
  if (match) {
    const [, year, month, day] = match;
    const monthIndex = Number(month) - 1;
    // Reject impossible dates such as 2026-02-30 rather than printing them.
    const check = new Date(Date.UTC(Number(year), monthIndex, Number(day)));
    if (check.getUTCMonth() !== monthIndex || check.getUTCDate() !== Number(day)) return String(value);
    return datePart(year, monthIndex, Number(day));
  }

  const date = toDate(value);
  if (!date) return String(value);
  return datePart(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * A moment in time, such as `updated_at` / "Last updated", in the viewer's
 * local time: `'2026-09-26T09:21:25+00:00'` → `'26 Sep 2026, 17:21'` in
 * Singapore. No seconds: nobody reads them in a table, and they make every
 * value look different. A bare `YYYY-MM-DD` has no time, so it is shown as a
 * date instead of inventing "00:00".
 *
 * @param {string | Date | null | undefined} value
 * @returns {string} the formatted date and time, '—' when empty, or the value as given when it is not a date
 */
export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return formatDate(value);

  const date = toDate(value);
  if (!date) return String(value);
  const day = datePart(date.getFullYear(), date.getMonth(), date.getDate());
  return `${day}, ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}
