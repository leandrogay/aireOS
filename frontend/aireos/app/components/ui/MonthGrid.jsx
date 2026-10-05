'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTH_LABELS = Array.from({ length: 12 }, (_, monthIndex) =>
  new Date(2000, monthIndex, 1).toLocaleDateString('en-US', { month: 'short' }),
);

const yearButtonClass =
  'flex size-7 items-center justify-center rounded-md text-deep-violet-blue hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * Year switcher over a 4 × 3 grid of months, shared by Promotions' single
 * MonthPicker and the dashboard's month-range picker. Selection stays with
 * the parent, asked through the callbacks: `isSelected` months are solid
 * dark blue (a single pick, or a range's first and last month),
 * `isInRange` months between them are lavender, `isMuted` months are faded
 * (e.g. no data loaded yet) but still pickable, and `isDisabled` months
 * can't be picked at all (e.g. before the first loaded data). `minYear`
 * stops the year switcher going back past it.
 *
 * @param {{
 *   initialYear: number,
 *   onPick: (year: number, monthIndex: number) => void,
 *   isSelected: (year: number, monthIndex: number) => boolean,
 *   isInRange?: (year: number, monthIndex: number) => boolean,
 *   isMuted?: (year: number, monthIndex: number) => boolean,
 *   isDisabled?: (year: number, monthIndex: number) => boolean,
 *   minYear?: number | null,
 * }} props
 */
export default function MonthGrid({
  initialYear,
  onPick,
  isSelected,
  isInRange = () => false,
  isMuted = () => false,
  isDisabled = () => false,
  minYear = null,
}) {
  const [viewYear, setViewYear] = useState(minYear ? Math.max(initialYear, minYear) : initialYear);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewYear((year) => year - 1)}
          disabled={minYear !== null && viewYear <= minYear}
          className={yearButtonClass}
          aria-label="Previous year"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold tabular-nums text-deep-violet-blue" aria-live="polite">
          {viewYear}
        </span>
        <button
          type="button"
          onClick={() => setViewYear((year) => year + 1)}
          className={yearButtonClass}
          aria-label="Next year"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {MONTH_LABELS.map((label, monthIndex) => {
          const disabled = isDisabled(viewYear, monthIndex);
          const selected = !disabled && isSelected(viewYear, monthIndex);
          const inRange = !disabled && !selected && isInRange(viewYear, monthIndex);
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onPick(viewYear, monthIndex)}
              aria-pressed={selected || inRange}
              aria-label={`${label} ${viewYear}`}
              className={cn(
                'rounded-md px-1 py-1.5 text-sm text-deep-violet-blue transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet',
                isMuted(viewYear, monthIndex) && 'opacity-40',
                disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                inRange && 'bg-lavander hover:bg-lavander',
                selected && 'bg-deep-violet-blue text-white opacity-100 hover:bg-deep-violet-blue',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
