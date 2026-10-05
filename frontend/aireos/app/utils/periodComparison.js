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

// Whole days from `start` to `end` (parsed as local midnight, so no
// off-by-one across timezones).
export function daysBetween(start, end) {
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

// The dashboard opens without a comparison; a baseline is opt-in.
export const DEFAULT_COMPARE = 'none';

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
 *
 * A custom baseline starts where it was picked, but is cut to this period's
 * loaded week count when it holds more weeks — otherwise its extra weeks
 * chart as baseline-only bars with nothing to compare against, and its
 * total counts weeks this period doesn't have. `shortenedTo` is that week
 * count, for the UI to explain. A shorter custom pick is kept as is (the
 * comparison panel flags the uneven lengths).
 */
export function comparisonRange(compareTo, { start, end, latestWeekStart, latestDataEnd, custom }) {
  if (!start || !end || compareTo === 'none') return null;

  // latestDataEnd is the REAL last day loaded (from backend
  // get_default_date_range), not always latestWeekStart + 6 days -- when
  // the latest period is month-granularity data (e.g. a whole August, no
  // real weekly rows), the data can run to the end of the month. Falls back
  // to the old +6-days assumption only if latestDataEnd wasn't supplied.
  const latestWeekEnd = latestDataEnd || (latestWeekStart ? addDays(latestWeekStart, 6) : null);
  const trimmed = Boolean(latestWeekEnd) && end > latestWeekEnd && start <= latestWeekEnd;

  if (compareTo === 'custom') {
    if (!custom?.start || !custom?.end) return null;
    const picked = { start: custom.start, end: custom.end, trimmedTo: null, shortenedTo: null };
    const currentWeeks = loadedWeeksInRange(start, end, latestWeekStart)?.count ?? 0;
    const customWeeks = loadedWeeksInRange(custom.start, custom.end, latestWeekStart)?.count ?? 0;
    if (!currentWeeks || customWeeks <= currentWeeks) return picked;
    return {
      ...picked,
      end: weeksFrom(custom.start, currentWeeks, latestWeekStart),
      trimmedTo: trimmed ? latestWeekEnd : null,
      shortenedTo: currentWeeks,
    };
  }
  const wholeMonths = isWholeMonths(start, end);
  const months = compareTo === 'previous' ? -monthCount(start, end) : -12;
  const days = compareTo === 'previous' ? -(daysBetween(start, end) + 1) : -364;
  const shift = (iso) => (wholeMonths ? shiftMonths(iso, months) : addDays(iso, days));

  const baselineStart = shift(start);
  if (!trimmed) {
    const baselineEnd = wholeMonths ? periodBounds('month', shift(end)).end : shift(end);
    return { start: baselineStart, end: baselineEnd, trimmedTo: null, shortenedTo: null };
  }

  // Sales rows are weekly, so "the same days" can still hold a different
  // number of weeks (1–19 Aug has 2 week starts, 1–19 Jul has 3). Cut the
  // baseline to exactly as many weeks as this period has loaded instead.
  const loadedWeeks = loadedWeeksInRange(start, end, latestWeekStart)?.count ?? 0;
  return {
    start: baselineStart,
    end: weeksFrom(baselineStart, loadedWeeks, latestWeekStart),
    trimmedTo: latestWeekEnd,
    shortenedTo: null,
  };
}

// First sales week starting on or after `start`, on the loaded weeks'
// weekday grid (anchored at latestWeekStart).
function firstWeekOnOrAfter(start, latestWeekStart) {
  return addDays(latestWeekStart, Math.ceil(daysBetween(latestWeekStart, start) / 7) * 7);
}

// Last day of the `weeks`-th sales week starting on or after `start`.
function weeksFrom(start, weeks, latestWeekStart) {
  return addDays(firstWeekOnOrAfter(start, latestWeekStart), weeks * 7 - 1);
}

/**
 * Everything the dashboard derives from the "Compare to" choice: each option
 * with the range it would use (for the picker to show), the selected
 * baseline range (null for none), and the two periods' display names
 * ("Aug 2026" vs "Aug 2025") for the legend, panel and summary.
 */
export function comparisonSetup(compareTo, rangeInputs) {
  const options = COMPARE_OPTIONS.map((option) => ({
    ...option,
    range: comparisonRange(option.value, rangeInputs),
  }));
  const baseline = options.find((option) => option.value === compareTo)?.range ?? null;
  const periodNames = {
    current: formatPeriodName(rangeInputs.start, rangeInputs.end),
    baseline: baseline ? baselineName(compareTo, rangeInputs) : '',
  };
  return { options, baseline, periodNames };
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

const MONTH_YEAR_SHORT = { month: 'short', year: 'numeric' };

/**
 * Pairs this period's buckets with the baseline for the side-by-side chart.
 * The baseline is normally given as *weekly* rows, and each baseline week is
 * placed in this period's buckets by how `compareTo` relates the two ranges:
 *
 * - By week, 'last-year': with the week exactly 52 weeks (364 days) later —
 *   same weekday, same week of the year. Matching by position instead
 *   drifts by a week whenever the two ranges' first sales weeks sit at
 *   different offsets (Aug 1 2025 is a Friday, Aug 1 2024 a Thursday).
 * - By month, 'last-year' / 'previous': by the baseline week's own calendar
 *   month, in order (Aug 2024 → Aug 2025), so a month is compared with that
 *   whole calendar month, as the totals are.
 * - 'custom' (and 'previous' by week): by position — baseline week N with
 *   this period's week N, then into whichever bucket that week falls in, so
 *   a custom period straddling other months still lines up week for week.
 *
 * - `baselineGranularity: 'month'` (month view over monthly-only data, which
 *   has no weeks to pair): the baseline is given as *monthly* rows, and
 *   baseline month N goes with this period's month N for every `compareTo`.
 *
 * Baseline weeks with no partner inside this period (a 53rd week, or one
 * before its start) are left out of the chart rather than drawn as
 * comparison-only bars; the Comparison panel's totals still count them.
 *
 * Returns one row per bucket:
 * `{ index, axisStart, current, baseline, currentFormats, baselineFormats }`.
 * - `axisStart`: this period's bucket start, so a bucket with no current
 *   data still gets a real date label.
 * - `current`: this period's `periodTotal` row, or null.
 * - `baseline`: `{ revenue, units, label }` summed over the placed weeks,
 *   `label` naming them ("Jul 31 – Aug 6, 2025", "Aug 2024"), or null.
 * - `currentFormats` / `baselineFormats`: revenue per store format
 *   (`{ HYPER: 1234.5, … }`) from the optional `*ByFormat` rows, for the
 *   "By format" view; empty objects when not given.
 */
export function alignComparisonBuckets(
  currentTotals,
  baselineWeeks,
  {
    compareTo,
    granularity,
    baselineGranularity = 'week',
    currentStart,
    currentEnd,
    baselineStart,
    latestWeekStart,
    currentByFormat = [],
    baselineWeeksByFormat = [],
  },
) {
  const firstCurrentWeek = latestWeekStart ? firstWeekOnOrAfter(currentStart, latestWeekStart) : currentStart;
  const monthStart = periodBounds('month', currentStart).start;
  const axisStartFor = (index) =>
    granularity === 'month' ? shiftMonths(monthStart, index) : addDays(firstCurrentWeek, index * 7);
  const baselineByMonth = baselineGranularity === 'month';
  const byCalendarMonth = granularity === 'month' && compareTo !== 'custom';
  const monthLabels = byCalendarMonth || baselineByMonth;
  const currentIndex = (periodStart) => bucketIndex(granularity, currentStart, periodStart);
  // This period's bucket for a baseline week, or null when it has no partner.
  const baselineIndex = (weekStart) => {
    if (baselineByMonth) {
      const index = bucketIndex('month', baselineStart, weekStart);
      if (index < 0 || (currentEnd && axisStartFor(index) > currentEnd)) return null;
      return index;
    }
    if (byCalendarMonth) return bucketIndex('month', baselineStart, weekStart);
    const pairedWeek =
      compareTo === 'last-year'
        ? addDays(weekStart, 364)
        : addDays(firstCurrentWeek, bucketIndex('week', baselineStart, weekStart) * 7);
    if (pairedWeek < firstCurrentWeek || (currentEnd && pairedWeek > currentEnd)) return null;
    return currentIndex(pairedWeek);
  };

  const rows = new Map();
  const rowAt = (index) => {
    if (!rows.has(index)) {
      rows.set(index, {
        index,
        axisStart: axisStartFor(index),
        current: null,
        baseline: null,
        currentFormats: {},
        baselineFormats: {},
      });
    }
    return rows.get(index);
  };

  for (const row of currentTotals) {
    rowAt(currentIndex(row.period_start)).current = row;
  }
  for (const week of baselineWeeks) {
    const index = baselineIndex(week.period_start);
    if (index === null) continue;
    const bucket = rowAt(index);
    const sum = bucket.baseline ?? { firstWeekStart: week.period_start, lastWeekStart: week.period_start, revenue: 0, units: 0 };
    bucket.baseline = {
      firstWeekStart: week.period_start < sum.firstWeekStart ? week.period_start : sum.firstWeekStart,
      lastWeekStart: week.period_start > sum.lastWeekStart ? week.period_start : sum.lastWeekStart,
      revenue: sum.revenue + week.revenue,
      units: sum.units + week.units,
    };
  }
  for (const row of currentByFormat) {
    const formats = rowAt(currentIndex(row.period_start)).currentFormats;
    formats[row.format] = (formats[row.format] ?? 0) + row.revenue;
  }
  for (const row of baselineWeeksByFormat) {
    const index = baselineIndex(row.period_start);
    if (index === null) continue;
    const formats = rowAt(index).baselineFormats;
    formats[row.format] = (formats[row.format] ?? 0) + row.revenue;
  }

  const aligned = [...rows.values()].sort((a, b) => a.index - b.index);
  for (const row of aligned) {
    if (!row.baseline) continue;
    const { firstWeekStart, lastWeekStart } = row.baseline;
    if (monthLabels) {
      row.baseline.label = parseIso(firstWeekStart).toLocaleDateString('en-US', MONTH_YEAR_SHORT);
    } else {
      // With the year, since the baseline is often last year's.
      row.baseline.label = formatPeriodName(firstWeekStart, addDays(lastWeekStart, 6));
    }
  }
  return aligned;
}

/** Revenue/units summed over a mode's `periodTotal` rows. */
export function sumPeriodTotals(periodTotal = []) {
  return periodTotal.reduce(
    (acc, row) => ({ revenue: acc.revenue + row.revenue, units: acc.units + row.units }),
    { revenue: 0, units: 0 },
  );
}
