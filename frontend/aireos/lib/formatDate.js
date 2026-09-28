const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Format an API date (YYYY-MM-DD, or a timestamp starting with one) for
 * display as "01 Dec 2026".
 *
 * A named month cannot be misread as dd/mm vs mm/dd, and the zero-padded
 * day keeps every date the same length so a column of them lines up.
 * The string is split directly instead of going through `Date`, so the
 * day never shifts with the viewer's timezone, and the month names are
 * fixed here because `Intl` spells September "Sept" in some locales.
 *
 * Only for display — sort and compare on the raw YYYY-MM-DD value.
 *
 * @param {string | null | undefined} value
 * @param {string} [fallback] shown when value is blank or not a date
 * @returns {string}
 */
export function formatDate(value, fallback = '—') {
  const match = ISO_DATE.exec(String(value || ''));
  if (!match) return fallback;
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return fallback;
  return `${match[3]} ${MONTH_ABBREVIATIONS[monthIndex]} ${match[1]}`;
}
