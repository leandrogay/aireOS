// Relative, not '@/lib/...', so `npm test` (node --test) can import this file.
import { singaporeToday } from '../../lib/singaporeTime.js';

// One calendar year, clamped to whatever data actually exists (so an empty
// bound, or a range that doesn't reach the year, still returns something
// sane). ISO 'YYYY-MM-DD' strings compare lexicographically the same as
// chronologically, so plain string comparison is enough here.
function yearDateRange(year, bounds) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return {
    start: bounds.start && bounds.start > yearStart ? bounds.start : yearStart,
    end: bounds.end && bounds.end < yearEnd ? bounds.end : yearEnd,
  };
}

// Shared by any page that shows a rolling window of monthly data (Forecast,
// Inventory): defaults to the current calendar year only. Past years only
// show once a user explicitly widens the date filter. "This year" is the
// Singapore year, not the browser's.
export function currentYearDateRange(bounds = {}, today = singaporeToday()) {
  return yearDateRange(today.getFullYear(), bounds);
}

// The Scenario builder plans the next year (in 2026 it opens on 2027), cut
// off where the forecast ends. If the forecast doesn't reach next year yet,
// it falls back to this year rather than an empty range.
export function nextYearDateRange(bounds = {}, today = singaporeToday()) {
  const next = yearDateRange(today.getFullYear() + 1, bounds);
  return next.start <= next.end ? next : currentYearDateRange(bounds, today);
}

export const FORECAST_DATE_SESSION_KEY = 'aireos.forecast.dateRange';

export function readForecastDateSession(key = FORECAST_DATE_SESSION_KEY) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
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

export function writeForecastDateSession(start, end, key = FORECAST_DATE_SESSION_KEY) {
  if (typeof window === 'undefined' || !start || !end) return;
  sessionStorage.setItem(key, JSON.stringify({ start, end }));
}

export function clearForecastDateSession(key = FORECAST_DATE_SESSION_KEY) {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(key);
}
