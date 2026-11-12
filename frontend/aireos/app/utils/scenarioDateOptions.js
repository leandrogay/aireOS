import { parseYmd, toYmd } from './datePicker.js';

/**
 * Exact-day choices for a side offer within the forecast's first and last
 * months. Saved dates outside the view stay visible but cannot be picked.
 * Dates remain calendar dates in every browser timezone.
 *
 * @param {string[]} months forecast months as YYYY-MM-01
 * @param {string[]} [selected] the offer's saved start and end dates
 * @returns {Array<{ date: string, locked: boolean }>}
 */
export function promotionDayOptions(months, selected = []) {
  const sorted = [...new Set(months)].filter((month) => parseYmd(month)).sort();
  const available = new Set();
  if (sorted.length) {
    const day = parseYmd(sorted[0]);
    const lastMonth = parseYmd(sorted.at(-1));
    const lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
    while (day <= lastDay) {
      available.add(toYmd(day));
      day.setDate(day.getDate() + 1);
    }
  }
  const all = new Set([...available, ...selected.filter((date) => parseYmd(date))]);
  return [...all].sort().map((date) => ({ date, locked: !available.has(date) }));
}
