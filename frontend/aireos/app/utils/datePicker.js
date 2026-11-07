// Pure helpers behind ui/DatePicker and ui/RangeDatePicker: converting the
// app's YYYY-MM-DD strings to and from the Date objects react-day-picker
// works in, the min/max limits, and how a click moves a range draft.
//
// Dates are calendar dates, never instants: they become local-midnight Dates
// and are read back with getFullYear/getMonth/getDate, so no timezone can
// shift them by a day (see the time note in agents.md).

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// How far the month/year dropdowns reach when no min/max is given.
const YEARS_BACK = 10;
const YEARS_AHEAD = 5;

/**
 * 'YYYY-MM-DD' → local-midnight Date.
 *
 * @param {string | undefined} ymd
 * @returns {Date | undefined} undefined when empty or not a real date
 */
export function parseYmd(ymd) {
  const match = YMD.exec(String(ymd || ''));
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
}

/**
 * Date → 'YYYY-MM-DD', from its local calendar fields.
 *
 * @param {Date} date
 * @returns {string}
 */
export function toYmd(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * react-day-picker `disabled` matchers for days outside min/max.
 *
 * @param {string} [min] 'YYYY-MM-DD' or ''
 * @param {string} [max] 'YYYY-MM-DD' or ''
 * @returns {Array<{ before: Date } | { after: Date }>}
 */
export function outsideLimits(min, max) {
  const matchers = [];
  const minDate = parseYmd(min);
  const maxDate = parseYmd(max);
  if (minDate) matchers.push({ before: minDate });
  if (maxDate) matchers.push({ after: maxDate });
  return matchers;
}

/**
 * First and last month the calendar can show (and its year dropdown lists):
 * min/max when given, otherwise YEARS_BACK before and YEARS_AHEAD after today.
 *
 * @param {string} [min]
 * @param {string} [max]
 * @param {Date} today
 * @returns {{ startMonth: Date, endMonth: Date }}
 */
export function monthLimits(min, max, today) {
  const minDate = parseYmd(min);
  const maxDate = parseYmd(max);
  return {
    startMonth: minDate
      ? new Date(minDate.getFullYear(), minDate.getMonth(), 1)
      : new Date(today.getFullYear() - YEARS_BACK, 0, 1),
    endMonth: maxDate
      ? new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)
      : new Date(today.getFullYear() + YEARS_AHEAD, 11, 1),
  };
}

/**
 * The range draft after clicking `picked`. The first click (or any click once
 * both ends are set) starts a new range; the second sets the end, or starts
 * again from an earlier day. Clicking the start twice is a one-day range.
 *
 * @param {{ start: string, end: string }} draft
 * @param {string} picked 'YYYY-MM-DD'
 * @returns {{ start: string, end: string }}
 */
export function nextRangeDraft(draft, picked) {
  if (!draft.start || draft.end || picked < draft.start) return { start: picked, end: '' };
  return { start: draft.start, end: picked };
}

/**
 * Text for a range: '12 Mar – 30 Apr 2026', with the start's year dropped
 * when both ends share it. `format` turns one YYYY-MM-DD into '12 Mar 2026'
 * (lib/formatDate.formatDate).
 *
 * @param {string} start
 * @param {string} end
 * @param {(ymd: string) => string} format
 * @returns {string} '' when either end is missing
 */
export function rangeSummary(start, end, format) {
  if (!start || !end) return '';
  const startText = format(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startShown = sameYear ? startText.replace(` ${start.slice(0, 4)}`, '') : startText;
  return `${startShown} – ${format(end)}`;
}
