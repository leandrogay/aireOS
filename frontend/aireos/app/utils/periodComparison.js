// Pure helpers for the sales dashboard's "Compare to" baseline: which
// period the selected range is compared against, trimmed like-for-like to
// the data loaded so far, and how the two ranges' chart bars line up.
// No React, no fetching. All dates are ISO YYYY-MM-DD strings.

// ==== Date helpers (also used by dateRangePresets.js) ====

// Parsed as local midnight (not UTC) so no date shifts a day in negative-offset timezones.
export function parseIso(iso) {
  return new Date(`${iso}T00:00:00`);
}

export function toIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(iso, days) {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

function daysBetween(start, end) {
  return Math.round((parseIso(end) - parseIso(start)) / 86400000);
}

// e.g. "Sep 3 – Sep 9". Also used by RevenueTrendCard's x-axis.
export function formatWeekRange(periodStart) {
  if (!periodStart) return '';
  const opts = { month: 'short', day: 'numeric' };
  const start = parseIso(periodStart).toLocaleDateString('en-US', opts);
  const end = parseIso(addDays(periodStart, 6)).toLocaleDateString('en-US', opts);
  return `${start} – ${end}`;
}

/** Calendar bounds of the month or year containing `iso`. */
export function periodBounds(unit, iso) {
  const date = parseIso(iso);
  if (unit === 'year') {
    return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` };
  }
  return {
    start: toIso(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toIso(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

// Same day-of-month `months` away, clamped to that month's last day
// (Mar 31 − 1 month → Feb 28).
function shiftMonths(iso, months) {
  const date = parseIso(iso);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return toIso(target);
}

function isWholeMonths(start, end) {
  return periodBounds('month', start).start === start && periodBounds('month', end).end === end;
}

function monthCount(start, end) {
  const s = parseIso(start);
  const e = parseIso(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() + 1;
}

// ==== What a range counts ====

// Sales rows are weekly and the backend keeps a week when its start date
// falls inside the range (get_dashboard_summary's period_start filter), so
// a day range really selects "the loaded weeks that start in it".
export function loadedWeeksInRange(start, end, latestWeekStart) {
  if (!start || !end || !latestWeekStart) return null;
  const anchor = parseIso(latestWeekStart).getTime();
  const lastDay = end < latestWeekStart ? end : latestWeekStart;
  const firstOffset = Math.ceil((parseIso(start).getTime() - anchor) / (7 * 86400000));
  const lastOffset = Math.floor((parseIso(lastDay).getTime() - anchor) / (7 * 86400000));
  if (firstOffset > lastOffset) return { count: 0, firstStart: null, lastStart: null };
  return {
    count: lastOffset - firstOffset + 1,
    firstStart: addDays(latestWeekStart, firstOffset * 7),
    lastStart: addDays(latestWeekStart, lastOffset * 7),
  };
}

// Day of week (0 = Sunday) the loaded weeks start on, so the calendar's
// rows line up exactly with the weeks being counted.
export function weekStartDay(latestWeekStart) {
  return latestWeekStart ? parseIso(latestWeekStart).getDay() : 1;
}

// ==== Compare to ====

export const COMPARE_OPTIONS = [
  { value: 'none', label: 'No comparison', short: 'No comparison' },
  { value: 'previous', label: 'Previous period', short: 'vs previous period' },
  { value: 'last-year', label: 'Same period last year', short: 'vs last year' },
  { value: 'custom', label: 'Custom period', short: 'vs custom period' },
];

export const DEFAULT_COMPARE = 'last-year';

/**
 * The baseline range for `compareTo`, or null when there is none.
 *
 * Previous / Same period last year shift the selected range back:
 * - Whole calendar months move by months (Jul → Jun, Jan 2026 → Jan 2025),
 *   so a month is always compared with a whole month.
 * - Any other range moves by its own length (previous) or by 52 weeks
 *   (last year), which keeps the weekly sales rows on the same weekday —
 *   the backend counts a week when its start date is in the range.
 *
 * Like-for-like: if the selected range runs past the latest loaded week
 * (e.g. MTD with data to 19 Aug), the baseline is cut to the same number of
 * sales weeks instead of counting a full month against a partial one.
 * `trimmedTo` is this period's data cut-off, for the UI to explain.
 * A custom baseline is used exactly as picked.
 */
export function comparisonRange(compareTo, { start, end, latestWeekStart, custom }) {
  if (!start || !end || compareTo === 'none') return null;
  if (compareTo === 'custom') {
    return custom?.start && custom?.end ? { start: custom.start, end: custom.end, trimmedTo: null } : null;
  }

  const latestWeekEnd = latestWeekStart ? addDays(latestWeekStart, 6) : null;
  const trimmed = Boolean(latestWeekEnd) && end > latestWeekEnd && start <= latestWeekEnd;
  const wholeMonths = isWholeMonths(start, end);
  const months = compareTo === 'previous' ? -monthCount(start, end) : -12;
  const days = compareTo === 'previous' ? -(daysBetween(start, end) + 1) : -364;
  const shift = (iso) => (wholeMonths ? shiftMonths(iso, months) : addDays(iso, days));

  const baselineStart = shift(start);
  if (!trimmed) {
    const baselineEnd = wholeMonths ? periodBounds('month', shift(end)).end : shift(end);
    return { start: baselineStart, end: baselineEnd, trimmedTo: null };
  }

  // Sales rows are weekly, so "the same days" can still hold a different
  // number of weeks (1–19 Aug has 2 week starts, 1–19 Jul has 3). Cut the
  // baseline to exactly as many weeks as this period has loaded instead.
  const loadedWeeks = loadedWeeksInRange(start, end, latestWeekStart)?.count ?? 0;
  const firstBaselineWeek = addDays(
    latestWeekStart,
    Math.ceil(daysBetween(latestWeekStart, baselineStart) / 7) * 7,
  );
  return {
    start: baselineStart,
    end: addDays(firstBaselineWeek, loadedWeeks * 7 - 1),
    trimmedTo: latestWeekEnd,
  };
}

const MONTH_YEAR = { month: 'short', year: 'numeric' };

/**
 * A range named the way people say it: "Aug 2026", "Jun – Aug 2026",
 * "Sep 2025 – Aug 2026", "2026", or plain dates ("Aug 13 – Aug 19, 2026")
 * when it isn't whole months. Used for the chart legend, the comparison
 * panel and the "vs …" deltas.
 */
export function formatPeriodName(start, end) {
  if (!start || !end) return '';
  if (!isWholeMonths(start, end)) {
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    const startLabel = parseIso(start).toLocaleDateString(
      'en-US',
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
    );
    const endLabel = parseIso(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  }
  if (start.endsWith('-01-01') && end.endsWith('-12-31') && start.slice(0, 4) === end.slice(0, 4)) {
    return start.slice(0, 4);
  }
  const endLabel = parseIso(end).toLocaleDateString('en-US', MONTH_YEAR);
  if (monthCount(start, end) === 1) return endLabel;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startLabel = parseIso(start).toLocaleDateString('en-US', sameYear ? { month: 'short' } : MONTH_YEAR);
  return `${startLabel} – ${endLabel}`;
}

/**
 * Name for a baseline: named after the whole period it stands for, not its
 * like-for-like trimmed dates — MTD vs last year reads "Aug 2025", not
 * "Aug 1 – Aug 20, 2025". The trimming is explained separately in the UI.
 */
export function baselineName(compareTo, { start, end, custom }) {
  const untrimmed = comparisonRange(compareTo, { start, end, latestWeekStart: '', custom });
  return untrimmed ? formatPeriodName(untrimmed.start, untrimmed.end) : '';
}

export function changePct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// "+12.1%" / "-3.4%" / "—", shared by the chart, cards, table and ranking.
export function formatChangePct(pct) {
  if (pct === null || pct === undefined) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ==== Chart alignment ====

// Position of a bucket within its range: 0 for the first week/month, 1 for
// the next… Both ranges' first weekly rows start within 6 days of their
// range start, so week N of this period lines up with week N of the
// baseline even when the weekdays differ.
function bucketIndex(granularity, rangeStart, periodStart) {
  if (granularity === 'month') return monthCount(rangeStart, periodStart) - 1;
  return Math.floor(daysBetween(rangeStart, periodStart) / 7);
}

/**
 * Pairs this period's `periodTotal` buckets with the baseline's by position
 * (week 1 with week 1, month 1 with month 1), for the side-by-side chart.
 * Returns one row per position: `{ index, current, baseline }`, either may
 * be null when only one side has data there.
 */
export function alignComparisonBuckets(currentTotals, baselineTotals, { granularity, currentStart, baselineStart }) {
  const rows = new Map();
  for (const row of currentTotals) {
    const index = bucketIndex(granularity, currentStart, row.period_start);
    rows.set(index, { index, current: row, baseline: null });
  }
  for (const row of baselineTotals) {
    const index = bucketIndex(granularity, baselineStart, row.period_start);
    rows.set(index, { index, current: rows.get(index)?.current ?? null, baseline: row });
  }
  return [...rows.values()].sort((a, b) => a.index - b.index);
}

/** Revenue/units summed over a mode's `periodTotal` rows. */
export function sumPeriodTotals(periodTotal = []) {
  return periodTotal.reduce(
    (acc, row) => ({ revenue: acc.revenue + row.revenue, units: acc.units + row.units }),
    { revenue: 0, units: 0 },
  );
}
