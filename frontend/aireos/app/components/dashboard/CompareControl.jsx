'use client';

import { useState } from 'react';
import { ChevronDown, GitCompareArrows } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import RangeCalendar from '@/components/dashboard/RangeCalendar';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/formatDateRange';

const actionButtonClass =
  'rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';

/**
 * "Compare to" control beside the Period control: No comparison, Previous
 * period, Same period last year (the default) or a Custom period picked on
 * the same range calendar. Each option shows the exact dates it would use
 * (worked out by comparisonRange in page.js), so the user never has to
 * guess what "previous" means for their range.
 *
 * @param {{
 *   value: 'none' | 'previous' | 'last-year' | 'custom',
 *   options: Array<{ value: string, label: string, short: string,
 *     range: { start: string, end: string } | null }>,
 *   latestWeekStart: string,
 *   latestDataEnd: string,
 *   onChange: (value: string, customRange?: { start: string, end: string }) => void,
 * }} props
 */
export default function CompareControl({ value, options, latestWeekStart, latestDataEnd, onChange }) {
  const [open, setOpen] = useState(false);
  const [pickingCustom, setPickingCustom] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });

  const selected = options.find((option) => option.value === value);
  const selectedDates = selected?.range ? formatDateRange(selected.range.start, selected.range.end) : null;

  function handleOpenChange(nextOpen) {
    if (nextOpen) setPickingCustom(false);
    setOpen(nextOpen);
  }

  function choose(option) {
    if (option.value === 'custom') {
      // Start from the current custom pick, else last year's range, so the
      // calendar opens somewhere sensible rather than empty.
      const lastYear = options.find((o) => o.value === 'last-year')?.range;
      setDraft(option.range ?? lastYear ?? { start: '', end: '' });
      setPickingCustom(true);
      return;
    }
    onChange(option.value);
    setOpen(false);
  }

  function applyCustom() {
    onChange('custom', { start: draft.start, end: draft.end || draft.start });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="flex items-center gap-1.5 rounded-md border border-violet bg-white px-2.5 py-1 text-xs text-deep-violet-blue hover:bg-lavander">
        <GitCompareArrows className="size-3.5" />
        <span className="font-semibold">{selected?.short ?? 'No comparison'}</span>
        {selectedDates && <span className="text-deep-violet-blue/70">· {selectedDates}</span>}
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] bg-white p-3">
        {!pickingCustom ? (
          <div className="flex w-64 flex-col gap-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => choose(option)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-left text-xs text-deep-violet-blue hover:bg-lavander',
                  value === option.value && 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue',
                )}
              >
                <span className="block font-medium">{option.label}</span>
                {option.range && (
                  <span className={cn('block', value === option.value ? 'text-white/80' : 'text-deep-violet-blue/60')}>
                    {formatDateRange(option.range.start, option.range.end)}
                  </span>
                )}
                {option.value === 'custom' && !option.range && (
                  <span className="block text-deep-violet-blue/60">Pick any dates, e.g. Mar vs Aug</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-deep-violet-blue">Compare with a custom period</p>
            <RangeCalendar
              draft={draft}
              onDraftChange={setDraft}
              latestWeekStart={latestWeekStart}
              latestDataEnd={latestDataEnd}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickingCustom(false)}
                className={cn(actionButtonClass, 'text-deep-violet-blue hover:bg-lavander')}
              >
                Back
              </button>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draft.start}
                className={cn(actionButtonClass, 'bg-deep-violet-blue text-white hover:bg-violet')}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
