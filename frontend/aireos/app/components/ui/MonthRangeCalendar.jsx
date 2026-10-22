'use client';

import MonthGrid from '@/components/ui/MonthGrid';
import { formatPeriodName, monthCount, parseIso, periodBounds, shiftMonths, toIso } from '@/app/utils/periodComparison';
import { singaporeToday } from '@/lib/singaporeTime';

// First day of a picked month, as the dashboard's ranges store it.
function monthStart(year, monthIndex) {
  return toIso(new Date(year, monthIndex, 1));
}

// Months are compared by their first day, so "YYYY-MM-01" strings sort and
// compare in calendar order.
function startOfMonth(iso) {
  return periodBounds('month', iso).start;
}

function monthsLabel(count) {
  return `${count} ${count === 1 ? 'month' : 'months'}`;
}

/**
 * Month picker used by both the Period and the custom Compare to controls,
 * on the shared year/month grid (MonthGrid). Ranges are always whole
 * months — the dashboard works in monthly figures, which can't be split by
 * day. Edits a draft `{ start, end }` (first day of the start month, last
 * day of the end month) — the parent applies it.
 *
 * - Range (Period): the first click picks the start month and the second
 *   the end month (either order); `end` is '' between the two clicks, which
 *   the parent applies as just the start month.
 * - `length` (custom Compare to): one click picks the start month and the
 *   range always runs `length` months from it, the same as the Period, so a
 *   comparison never covers more or fewer months than what it's compared
 *   with. The highlighted range shows exactly what will be compared.
 *
 * Months before `earliestDataStart` (the first loaded data) can't be picked
 * and the year switcher stops at its year; months after the latest loaded
 * data are faded but still pickable.
 *
 * @param {{
 *   draft: { start: string, end: string },
 *   onDraftChange: (range: { start: string, end: string }) => void,
 *   latestDataEnd: string,
 *   earliestDataStart?: string,
 *   length?: number | null,
 * }} props
 */
export default function MonthRangeCalendar({ draft, onDraftChange, latestDataEnd, earliestDataStart = '', length = null }) {
  const first = draft.start ? startOfMonth(draft.start) : '';
  const last = draft.end ? startOfMonth(draft.end) : first;
  const shown = draft.end || draft.start;
  const initialYear = shown ? parseIso(shown).getFullYear() : singaporeToday().getFullYear();
  const latestMonth = latestDataEnd ? startOfMonth(latestDataEnd) : '';
  const earliestMonth = earliestDataStart ? startOfMonth(earliestDataStart) : '';

  function pick(year, monthIndex) {
    const picked = monthStart(year, monthIndex);
    if (length) {
      onDraftChange({ start: picked, end: periodBounds('month', shiftMonths(picked, length - 1)).end });
      return;
    }
    // A third click starts a new range rather than moving one end.
    if (!draft.start || draft.end) {
      onDraftChange({ start: picked, end: '' });
      return;
    }
    const [from, to] = picked < first ? [picked, first] : [first, picked];
    onDraftChange({ start: from, end: periodBounds('month', to).end });
  }

  let note;
  if (!draft.start) {
    note = length ? `Pick the first month to compare with (${monthsLabel(length)}, same as the Period).` : 'Pick a start month.';
  } else if (length) {
    note = `Compares ${formatPeriodName(draft.start, draft.end)} (${monthsLabel(length)}, same as the Period).`;
  } else if (!draft.end) {
    note = `${formatPeriodName(draft.start, periodBounds('month', draft.start).end)} picked. Pick an end month, or Apply for just this month.`;
  } else {
    note = `${formatPeriodName(draft.start, draft.end)} · ${monthsLabel(monthCount(draft.start, draft.end))}`;
  }

  return (
    <div className="w-64">
      <MonthGrid
        initialYear={initialYear}
        minYear={earliestMonth ? parseIso(earliestMonth).getFullYear() : null}
        onPick={pick}
        isSelected={(year, monthIndex) => {
          const month = monthStart(year, monthIndex);
          return month === first || month === last;
        }}
        isInRange={(year, monthIndex) => {
          const month = monthStart(year, monthIndex);
          return Boolean(first) && month > first && month < last;
        }}
        isMuted={(year, monthIndex) => Boolean(latestMonth) && monthStart(year, monthIndex) > latestMonth}
        isDisabled={(year, monthIndex) => Boolean(earliestMonth) && monthStart(year, monthIndex) < earliestMonth}
      />
      <p className="mt-2 text-xs text-deep-violet-blue/60">{note}</p>
    </div>
  );
}
