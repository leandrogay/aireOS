import { singaporeToday } from '@/lib/singaporeTime';

// Shared by any page that shows a rolling window of monthly data (Forecast,
// Inventory): defaults to the current calendar year only, clamped to
// whatever data actually exists (so an empty bound, or a range that doesn't
// reach this year, still returns something sane). Past years only show once
// a user explicitly widens the date filter. ISO 'YYYY-MM-DD' strings compare
// lexicographically the same as chronologically, so plain string comparison
// is enough here. "This year" is the Singapore year, not the browser's.
export function currentYearDateRange(bounds = {}) {
  const year = singaporeToday().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return {
    start: bounds.start && bounds.start > yearStart ? bounds.start : yearStart,
    end: bounds.end && bounds.end < yearEnd ? bounds.end : yearEnd,
  };
}

const FORECAST_DATE_SESSION_KEY = 'aireos.forecast.dateRange';

export function readForecastDateSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FORECAST_DATE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.start === 'string' && typeof parsed?.end === 'string' && parsed.start && parsed.end) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function writeForecastDateSession(start, end) {
  if (typeof window === 'undefined' || !start || !end) return;
  sessionStorage.setItem(FORECAST_DATE_SESSION_KEY, JSON.stringify({ start, end }));
}
