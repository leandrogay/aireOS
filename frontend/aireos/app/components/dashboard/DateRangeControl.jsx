'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import RangeCalendar from '@/components/dashboard/RangeCalendar';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/formatDateRange';
import { findPreset } from '@/app/utils/dateRangePresets';
import { addDays } from '@/app/utils/periodComparison';

const actionButtonClass =
  'rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';

/**
 * The dashboard's Period control, above the trend chart. The trigger
 * always shows the range the dashboard is actually using — its preset name
 * (e.g. "MTD") or "Custom" — so there is never a highlighted preset next to
 * blank inputs. The popover lists presets on the left (applied at once) and
 * a range calendar on the right (see RangeCalendar), applied on Apply.
 *
 * @param {{
 *   start: string,
 *   end: string,
 *   presets: Array<{ id: string, label: string, start: string, end: string }>,
 *   latestWeekStart: string,
 *   onChange: (start: string, end: string) => void,
 * }} props
 */
export default function DateRangeControl({ start, end, presets, latestWeekStart, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start, end });

  const activePreset = findPreset(presets, start, end);
  // Show only the dates that have data: MTD is Aug 1 – 31 underneath (so it
  // compares month for month and grows as weeks load), but with data to
  // 19 Aug the button reads Aug 1 – 19, matching the comparison card.
  const latestWeekEnd = latestWeekStart ? addDays(latestWeekStart, 6) : '';
  const displayEnd = latestWeekEnd && end > latestWeekEnd && start <= latestWeekEnd ? latestWeekEnd : end;

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
    onChange(draft.start, draft.end || draft.start);
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
        <span className="text-deep-violet-blue/70">· {formatDateRange(start, displayEnd) ?? 'Loading…'}</span>
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] bg-white p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 sm:w-32 sm:flex-col sm:border-r sm:border-lavander sm:pr-3">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-md px-2 py-1 text-left text-xs text-deep-violet-blue hover:bg-lavander',
                  activePreset?.id === preset.id && 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <RangeCalendar
              draft={draft}
              onDraftChange={setDraft}
              latestWeekStart={latestWeekStart}
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
