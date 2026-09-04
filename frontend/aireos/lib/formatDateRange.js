const MONTH_DAY = { month: 'short', day: 'numeric' };
const MONTH_DAY_YEAR = { month: 'short', day: 'numeric', year: 'numeric' };

// Formats an ISO (YYYY-MM-DD) start/end pair as "Jan 1 - Jan 31, 2024" (same
// year) or "Jan 1, 2024 - Feb 3, 2025" (crossing years). Appending T00:00:00
// forces local-midnight parsing instead of UTC, avoiding an off-by-one-day
// shift in negative-UTC-offset timezones.
export function formatDateRange(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = startDate.toLocaleDateString('en-US', sameYear ? MONTH_DAY : MONTH_DAY_YEAR);
  const endLabel = endDate.toLocaleDateString('en-US', MONTH_DAY_YEAR);
  return `${startLabel} - ${endLabel}`;
}
