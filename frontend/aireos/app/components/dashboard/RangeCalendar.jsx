'use client';

import { getDefaultClassNames } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { addDays, loadedWeeksInRange, parseIso, toIso, weekStartDay } from '@/app/utils/periodComparison';

// Tiny "Start" / "End" caption above the picked day. It sits in its own
// micro-row: calendarClassNames.week leaves a 16px gap above every row and
// the caption (9px) is placed inside it, so it never touches the weekday
// header or the row above. A pseudo-element on the day cell, so it adds no
// layout and the grid doesn't shift as dates are picked.
const edgeLabelClass =
  'before:pointer-events-none before:absolute before:inset-x-0 before:-top-[13px] before:z-10 before:text-center before:text-[9px] before:font-semibold before:leading-none before:text-deep-violet-blue';

// Roomier spacing than the ui/calendar defaults (which these keys replace,
// so the base layout classes are restated): a wider gap between the two
// months, more space between month title and weekday header, and the
// caption micro-row above each week.
const defaultClassNames = getDefaultClassNames();
const calendarClassNames = {
  months: `relative flex flex-col gap-6 md:flex-row md:gap-8 ${defaultClassNames.months}`,
  month: `flex w-full flex-col gap-5 ${defaultClassNames.month}`,
  week: `mt-4 flex w-full ${defaultClassNames.week}`,
};

// Custom modifier names rather than react-day-picker's own range_start /
// range_end: a modifiersClassNames entry for those would replace the
// calendar primitive's range styling instead of adding to it.
function edgeLabelModifiers(draft) {
  if (!draft.start) return {};
  const start = parseIso(draft.start);
  if (!draft.end) return { startLabel: start };
  if (draft.end === draft.start) return { startEndLabel: start };
  return { startLabel: start, endLabel: parseIso(draft.end) };
}

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
 *   latestDataEnd: string,
 * }} props
 */
export default function RangeCalendar({ draft, onDraftChange, latestWeekStart, latestDataEnd }) {
  // latestDataEnd is the real last day loaded (may be a whole month's end,
  // not always latestWeekStart + 6 days); falls back to the old +6-days
  // assumption if it wasn't supplied (the Compare-to custom-range calendar
  // doesn't currently pass it, so it keeps its existing behavior).
  const latestWeekEnd = latestDataEnd || (latestWeekStart ? addDays(latestWeekStart, 6) : null);
  const weeks = loadedWeeksInRange(draft.start, draft.end || draft.start, latestWeekStart);
  const endDate = draft.start ? parseIso(draft.end || draft.start) : new Date();

  return (
    <div>
      {/* Selected start/end days use --primary; pointing it at the brand deep
          blue here recolours this calendar only (globals.css uses @theme
          inline, so bg-primary reads the variable at this element). */}
      <Calendar
        className="[--primary:var(--aire-deep-blue)] [--primary-foreground:white]"
        classNames={calendarClassNames}
        mode="range"
        resetOnSelect
        numberOfMonths={2}
        // Each month shows only its own days: with two months side by side,
        // early-August days repeated at the end of the July grid read as a
        // second, conflicting selection.
        showOutsideDays={false}
        defaultMonth={new Date(endDate.getFullYear(), endDate.getMonth() - 1, 1)}
        weekStartsOn={weekStartDay(latestWeekStart)}
        selected={draft.start ? { from: parseIso(draft.start), to: draft.end ? parseIso(draft.end) : undefined } : undefined}
        onSelect={(range) => {
          if (!range?.from) return;
          onDraftChange({ start: toIso(range.from), end: range.to ? toIso(range.to) : '' });
        }}
        // Days past the newest loaded week have no data yet — muted, but
        // still selectable so a future period can be set up ahead of time.
        modifiers={{
          ...(latestWeekEnd && { noData: { after: parseIso(latestWeekEnd) } }),
          ...edgeLabelModifiers(draft),
        }}
        modifiersClassNames={{
          noData: 'opacity-40',
          startLabel: `${edgeLabelClass} before:content-['Start']`,
          endLabel: `${edgeLabelClass} before:content-['End']`,
          startEndLabel: `${edgeLabelClass} before:content-['Start/End']`,
        }}
      />
      {/* w-0 + min-w-full: the note wraps to the calendar's width instead of
          setting it. Its text changes with every click ("Pick an end date."
          vs "Counts 2 loaded weeks…"), and a popover whose width changes
          gets re-aligned by its collision handling, jumping across the page. */}
      <p className="mt-2 w-0 min-w-full text-xs text-deep-violet-blue/60">
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
