'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import MonthRangeCalendar from '@/components/dashboard/MonthRangeCalendar';
import { cn } from '@/lib/utils';
import { findPreset } from '@/app/utils/dateRangePresets';
import { formatPeriodName, periodBounds } from '@/app/utils/periodComparison';

const actionButtonClass =
  'rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';
const sectionLabelClass = 'text-[11px] font-medium uppercase tracking-wide text-deep-violet-blue/60';

/**
 * The dashboard's Period control, above the trend chart. The trigger
 * always shows the range the dashboard is actually using — its preset name
 * (e.g. "Latest month") or "Custom" — so there is never a highlighted preset
 * next to a blank picker. The popover lists presets on the left (applied at
 * once) and a month-range picker on the right (see MonthRangeCalendar),
 * applied on Apply. Ranges are always whole months: the dashboard works in
 * monthly figures. Both sides carry a small header, and every preset is
 * drawn as an outlined button rather than plain text, so the options read
 * as clickable instead of as a label for the active one.
 *
 * @param {{
 *   start: string,
 *   end: string,
 *   presets: Array<{ id: string, label: string, start: string, end: string }>,
 *   latestDataEnd: string,
 *   earliestDataStart: string,
 *   onChange: (start: string, end: string) => void,
 * }} props
 */
export default function DateRangeControl({ start, end, presets, latestDataEnd, earliestDataStart, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start, end });

  const activePreset = findPreset(presets, start, end);
  // Show only the dates that have data: Latest month is Aug 1 – 31
  // underneath (so it compares month for month), but if only weekly data to
  // 19 Aug is loaded the button reads Aug 1 – 19, matching the comparison
  // card. latestDataEnd is the real last day loaded.
  const displayEnd = latestDataEnd && end > latestDataEnd && start <= latestDataEnd ? latestDataEnd : end;

  function handleOpenChange(nextOpen) {
    // Each opening starts from what the dashboard is showing, not a
    // half-finished pick from last time.
    if (nextOpen) setDraft({ start, end });
    setOpen(nextOpen);
  }

  function applyPreset(preset) {
    onChange(preset.start, preset.end);
    setOpen(false);
  }

  function applyDraft() {
    // One click picks just that month.
    onChange(draft.start, draft.end || periodBounds('month', draft.start).end);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={!start}
        className="flex items-center gap-1.5 rounded-md border border-violet bg-white px-2.5 py-1 text-xs text-deep-violet-blue hover:bg-lavander disabled:opacity-50"
      >
        <CalendarDays className="size-3.5" />
        <span className="font-semibold">{activePreset ? activePreset.label : 'Custom'}</span>
        <span className="text-deep-violet-blue/70">· {formatPeriodName(start, displayEnd) || 'Loading…'}</span>
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      {/* Start-aligned: Period is the left-hand control, so the popover has
          room to open rightwards instead of over the sidebar. */}
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] bg-white p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
          <div className="flex flex-col gap-2 sm:w-36 sm:border-r sm:border-lavander sm:pr-5">
            <p className={sectionLabelClass}>Presets</p>
            <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  aria-pressed={activePreset?.id === preset.id}
                  className={cn(
                    'rounded-md border border-lavander bg-white px-2 py-1 text-left text-xs text-deep-violet-blue transition-colors hover:border-violet hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet',
                    activePreset?.id === preset.id &&
                      'border-deep-violet-blue bg-deep-violet-blue text-white hover:border-deep-violet-blue hover:bg-deep-violet-blue',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className={sectionLabelClass}>Custom months</p>
            <MonthRangeCalendar
              draft={draft}
              onDraftChange={setDraft}
              latestDataEnd={latestDataEnd}
              earliestDataStart={earliestDataStart}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(actionButtonClass, 'text-deep-violet-blue hover:bg-lavander')}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyDraft}
                disabled={!draft.start}
                className={cn(actionButtonClass, 'bg-deep-violet-blue text-white hover:bg-violet')}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
