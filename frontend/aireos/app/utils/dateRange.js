// Shared by any page that shows a rolling window of monthly data (Forecast,
// Inventory): defaults to the current calendar year only, clamped to
// whatever data actually exists (so an empty bound, or a range that doesn't
// reach this year, still returns something sane). Past years only show once
// a user explicitly widens the date filter. ISO 'YYYY-MM-DD' strings compare
// lexicographically the same as chronologically, so plain string comparison
// is enough here.
export function currentYearDateRange(bounds = {}) {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return {
    start: bounds.start && bounds.start > yearStart ? bounds.start : yearStart,
    end: bounds.end && bounds.end < yearEnd ? bounds.end : yearEnd,
  };
}
