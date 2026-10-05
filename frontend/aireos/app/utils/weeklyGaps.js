// Pure helpers for the dashboard's "no weekly data" message: which months
// were uploaded only as monthly totals (backend get_monthly_only_months),
// grouped into readable ranges so users know exactly which weekly sell-out
// to upload. No React, no fetching. Months are YYYY-MM-01 strings.

import { formatPeriodName, periodBounds } from '@/app/utils/periodComparison';

// How many ranges the message names before summarising the rest as
// "and N more" (all of them are in `detail`, the message's hover text).
export const MAX_NAMED_RANGES = 3;

function nextMonth(month) {
  const [year, monthIndex] = month.split('-').map(Number);
  return monthIndex === 12 ? `${year + 1}-01-01` : `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

/**
 * Consecutive months merged into ranges, each named the way the dashboard
 * names periods: ["2026-06-01", "2026-07-01", "2026-08-01", "2026-11-01"]
 * → ["Jun – Aug 2026", "Nov 2026"]. Duplicates and order don't matter.
 */
export function monthRangeLabels(months) {
  const sorted = [...new Set(months)].sort();
  const ranges = [];
  for (const month of sorted) {
    const last = ranges.at(-1);
    if (last && nextMonth(last.end) === month) {
      last.end = month;
    } else {
      ranges.push({ start: month, end: month });
    }
  }
  return ranges.map((range) => formatPeriodName(range.start, periodBounds('month', range.end).end));
}

/**
 * The message for a weekly chart missing monthly-only months, or null when
 * none are missing. Names up to MAX_NAMED_RANGES ranges and summarises the
 * rest, so a long gap list never floods the chart header; `detail` lists
 * every range, for the hover text.
 *
 * @param {string[]} months  monthly-only months from either side of a comparison
 * @returns {{ text: string, detail: string } | null}
 */
export function weeklyGapMessage(months) {
  const labels = monthRangeLabels(months);
  if (labels.length === 0) return null;
  const named = labels.slice(0, MAX_NAMED_RANGES).join(', ');
  const more = labels.length - MAX_NAMED_RANGES;
  const list = more > 0 ? `${named} and ${more} more` : named;
  const monthCount = new Set(months).size;
  return {
    text: `No weekly data for ${list}: only monthly totals were uploaded. View by month, or upload weekly sell-out for ${
      monthCount === 1 ? 'that month' : 'those months'
    }.`,
    detail: `Months with monthly totals only: ${labels.join(', ')}`,
  };
}

/**
 * Whether the range has any month with weekly rows, i.e. one that isn't in
 * `monthlyOnlyMonths`. When every month is monthly-only, the dashboard's
 * By week drill-down has nothing to show and is disabled.
 */
export function rangeHasWeeklyMonths(start, end, monthlyOnlyMonths) {
  if (!start || !end) return false;
  const monthlyOnly = new Set(monthlyOnlyMonths);
  for (let month = periodBounds('month', start).start; month <= end; month = nextMonth(month)) {
    if (!monthlyOnly.has(month)) return true;
  }
  return false;
}
