// The app shows every time in Singapore time, whatever timezone the viewer's
// browser is in. The backend sends instants in UTC (ISO with Z / +00:00).
//
// Singapore has no daylight saving, so a fixed +08:00 shift is exact: move
// the instant 8 hours forward and read its UTC fields to get the Singapore
// wall clock. Done by hand rather than with Intl so lib/formatDate.js keeps
// printing the same text on every browser (see the note there).

const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The Singapore wall-clock fields of an instant.
 *
 * @param {Date} date
 * @returns {{ year: number, monthIndex: number, day: number, hours: number, minutes: number }}
 */
export function singaporeDateTimeParts(date) {
  const shifted = new Date(date.getTime() + SINGAPORE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/**
 * Today's Singapore calendar date, as a local-midnight Date so callers can
 * keep using getFullYear / getMonth / getDate on it. Use this instead of
 * `new Date()` wherever "today", "this month" or "this year" matters.
 *
 * @param {Date} [now]
 * @returns {Date}
 */
export function singaporeToday(now = new Date()) {
  const { year, monthIndex, day } = singaporeDateTimeParts(now);
  return new Date(year, monthIndex, day);
}
