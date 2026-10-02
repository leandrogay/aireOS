// Pure helpers for the dashboard's date range control: the preset list
// (Latest week, MTD, Last month, QTD, YTD…). Every preset is anchored to the latest *loaded* week for the
// channel (backend get_default_date_range period=week), not today's date —
// if uploads lag, "MTD" still means the month the newest data is in.
// No React, no fetching. All dates are ISO YYYY-MM-DD strings.

import { addDays, parseIso, periodBounds, toIso } from '@/app/utils/periodComparison';

// ==== Presets ====

function monthsBack(iso, months) {
  const date = parseIso(iso);
  return toIso(new Date(date.getFullYear(), date.getMonth() - months, 1));
}

function quarterBounds(iso) {
  const date = parseIso(iso);
  const firstMonth = Math.floor(date.getMonth() / 3) * 3;
  return {
    start: toIso(new Date(date.getFullYear(), firstMonth, 1)),
    end: toIso(new Date(date.getFullYear(), firstMonth + 3, 0)),
  };
}

/**
 * Preset ranges, in the order the control lists them. Month-based presets
 * (MTD, Past 3/12 months, QTD, YTD) end at the end of that month/quarter/
 * year rather than at the latest week: no data exists past the latest week
 * anyway, and whole months let "Compare to" match month for month (see
 * comparisonRange). MTD is also the dashboard's default range.
 */
export function buildDateRangePresets(latestWeekStart) {
  if (!latestWeekStart) return [];
  const latestWeekEnd = addDays(latestWeekStart, 6);
  const month = periodBounds('month', latestWeekStart);

  return [
    { id: 'latest-week', label: 'Latest week', start: latestWeekStart, end: latestWeekEnd },
    { id: 'mtd', label: 'MTD', start: month.start, end: month.end },
    { id: 'last-month', label: 'Last month', ...periodBounds('month', addDays(month.start, -1)) },
    { id: 'past-3-months', label: 'Past 3 months', start: monthsBack(month.start, 2), end: month.end },
    { id: 'qtd', label: 'QTD', ...quarterBounds(latestWeekStart) },
    { id: 'ytd', label: 'YTD', ...periodBounds('year', latestWeekStart) },
    { id: 'past-12-months', label: 'Past 12 months', start: monthsBack(month.start, 11), end: month.end },
  ];
}

export const DEFAULT_PRESET_ID = 'mtd';

export function findPreset(presets, start, end) {
  return presets.find((preset) => preset.start === start && preset.end === end) ?? null;
}
