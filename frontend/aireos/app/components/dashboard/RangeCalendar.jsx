'use client';

import { Calendar } from '@/components/ui/calendar';
import { addDays, loadedWeeksInRange, parseIso, toIso, weekStartDay } from '@/app/utils/periodComparison';

function formatDayMonthYear(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Two-month range calendar used by both the Period and the custom Compare
 * to pickers. Its rows are the loaded sales weeks (same start weekday — see
 * weekStartDay), and a note under it spells out which weeks the range will
 * actually count, since the backend keeps a week when its start date falls
 * inside the range. Edits a draft `{ start, end }` — the parent applies it.
 *
 * @param {{
 *   draft: { start: string, end: string },
 *   onDraftChange: (range: { start: string, end: string }) => void,
 *   latestWeekStart: string,
 * }} props
 */
export default function RangeCalendar({ draft, onDraftChange, latestWeekStart }) {
  const latestWeekEnd = latestWeekStart ? addDays(latestWeekStart, 6) : null;
  const weeks = loadedWeeksInRange(draft.start, draft.end || draft.start, latestWeekStart);
  const endDate = draft.start ? parseIso(draft.end || draft.start) : new Date();

  return (
    <div>
      <Calendar
        mode="range"
        resetOnSelect
        numberOfMonths={2}
        defaultMonth={new Date(endDate.getFullYear(), endDate.getMonth() - 1, 1)}
        weekStartsOn={weekStartDay(latestWeekStart)}
        selected={draft.start ? { from: parseIso(draft.start), to: draft.end ? parseIso(draft.end) : undefined } : undefined}
        onSelect={(range) => {
          if (!range?.from) return;
          onDraftChange({ start: toIso(range.from), end: range.to ? toIso(range.to) : '' });
        }}
        // Days past the newest loaded week have no data yet — muted, but
        // still selectable so a future period can be set up ahead of time.
        modifiers={latestWeekEnd ? { noData: { after: parseIso(latestWeekEnd) } } : undefined}
        modifiersClassNames={{ noData: 'opacity-40' }}
      />
      <p className="mt-1 max-w-[31rem] text-xs text-deep-violet-blue/60">
        {!draft.start && 'Pick a start date.'}
        {draft.start && !draft.end && 'Pick an end date.'}
        {draft.end && weeks?.count > 0 &&
          `Counts ${weeks.count} loaded ${weeks.count === 1 ? 'week' : 'weeks'} starting ${formatDayMonthYear(weeks.firstStart)}` +
            (weeks.count > 1 ? ` – ${formatDayMonthYear(weeks.lastStart)}` : '') +
            '. Each calendar row is one sales week.'}
        {draft.end && weeks?.count === 0 && 'No loaded sales weeks start in this range.'}
      </p>
    </div>
  );
}
