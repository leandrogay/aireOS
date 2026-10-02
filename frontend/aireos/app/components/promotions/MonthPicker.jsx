'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import { singaporeToday } from '@/lib/singaporeTime';
import { cn } from '@/lib/utils';
import {
  MONTH_NAMES,
  formatMonthLabel,
  monthPeriod,
  yearMonthFromYmd,
} from '@/app/utils/promotionForm';

const yearButtonClass =
  'flex size-7 items-center justify-center rounded-md text-deep-violet-blue hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet';

/**
 * Year switcher over a 4 × 3 grid of months. It only mounts while the
 * dropdown is open, so every time it opens it starts on the selected
 * month's year (or this year when nothing is picked yet).
 *
 * @param {{
 *   selected: { year: number, monthIndex: number } | null,
 *   onPick: (year: number, monthIndex: number) => void,
 * }} props
 */
function MonthGrid({ selected, onPick }) {
  const [viewYear, setViewYear] = useState(
    () => selected?.year ?? singaporeToday().getFullYear(),
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewYear((year) => year - 1)}
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
        {MONTH_NAMES.map((name, monthIndex) => {
          const isSelected =
            selected?.year === viewYear && selected?.monthIndex === monthIndex;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onPick(viewYear, monthIndex)}
              aria-pressed={isSelected}
              aria-label={`${name} ${viewYear}`}
              className={cn(
                'rounded-md px-1 py-1.5 text-sm text-deep-violet-blue transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet',
                isSelected && 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue',
              )}
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Month + year picker for Monthly promotions. Picking a month reports
 * that month's first and last day as periodStart / periodEnd.
 *
 * @param {{
 *   value: string,
 *   onChange: (period: { periodStart: string, periodEnd: string }) => void,
 *   invalid?: boolean,
 * }} props value is the current periodStart (YYYY-MM-DD)
 */
export default function MonthPicker({ value, onChange, invalid = false }) {
  const selected = yearMonthFromYmd(value);

  return (
    <CheckboxDropdown
      summary={formatMonthLabel(value)}
      placeholder="Select month"
      invalid={invalid}
    >
      {(_query, close) => (
        <MonthGrid
          selected={selected}
          onPick={(year, monthIndex) => {
            onChange(monthPeriod(year, monthIndex));
            close();
          }}
        />
      )}
    </CheckboxDropdown>
  );
}
