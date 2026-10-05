// Pure helpers for the dashboard's Period control: the preset list (Latest
// month, Past 3/6/12 months, Year to date, Last year). Every preset is a run
// of whole calendar months — the dashboard works in monthly figures, which
// can't be split — anchored to the month of the latest *loaded* period for
// the channel (backend get_default_date_range period=week), not today's
// date: if uploads lag, "Latest month" still means the newest data's month.
// No React, no fetching. All dates are ISO YYYY-MM-DD strings.

import { parseIso, periodBounds, toIso } from '@/app/utils/periodComparison';

// ==== Presets ====

function monthsBack(iso, months) {
  const date = parseIso(iso);
  return toIso(new Date(date.getFullYear(), date.getMonth() - months, 1));
}

/**
 * Preset ranges, in the order the control lists them. Each ends with the
 * latest loaded month, except Last year (the whole previous calendar year).
 * Latest month is the dashboard's default range.
 */
export function buildDateRangePresets(latestPeriodStart) {
  if (!latestPeriodStart) return [];
  const month = periodBounds('month', latestPeriodStart);
  const year = periodBounds('year', latestPeriodStart);
  const lastYear = periodBounds('year', monthsBack(year.start, 12));

  return [
    { id: 'latest-month', label: 'Latest month', ...month },
    { id: 'past-3-months', label: 'Past 3 months', start: monthsBack(month.start, 2), end: month.end },
    { id: 'past-6-months', label: 'Past 6 months', start: monthsBack(month.start, 5), end: month.end },
    { id: 'past-12-months', label: 'Past 12 months', start: monthsBack(month.start, 11), end: month.end },
    { id: 'ytd', label: 'Year to date', start: year.start, end: month.end },
    { id: 'last-year', label: 'Last year', ...lastYear },
  ];
}

export const DEFAULT_PRESET_ID = 'latest-month';

export function findPreset(presets, start, end) {
  return presets.find((preset) => preset.start === start && preset.end === end) ?? null;
}
