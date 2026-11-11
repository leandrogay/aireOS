'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { calendarIconClass, calendarPanelClass, typedBoxClass, typedInputClass } from '@/components/ui/DatePicker';
import { DateInput, maxYmd, minYmd } from '@/components/ui/DateRangePicker';
import Dropdown from '@/components/ui/Dropdown';
import { invalidInputClass } from '@/components/ui/formStyles';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { monthLimits, nextRangeDraft, outsideLimits, parseYmd, rangeSummary, toYmd } from '@/app/utils/datePicker';
import useMediaQuery from '@/hooks/useMediaQuery';
import { formatDate } from '@/lib/formatDate';
import { singaporeToday } from '@/lib/singaporeTime';
import { cn } from '@/lib/utils';

/**
 * Two months side by side (one on a phone) and an Apply / Clear row. Picks
 * build a draft (first click the start, second the end) that only reaches
 * the page on Apply, so a half-picked range never does. It mounts each time
 * the panel opens, so the draft always starts from the applied range.
 *
 * @param {{
 *   start: string,
 *   end: string,
 *   min?: string,
 *   max?: string,
 *   clearable: boolean,
 *   onApply: (range: { start: string, end: string }) => void,
 *   onClear: () => void,
 * }} props
 */
function RangePanel({ start, end, min, max, clearable, onApply, onClear }) {
  const [draft, setDraft] = useState({ start, end });
  const narrow = useMediaQuery('(max-width: 639px)');
  const today = singaporeToday();

  let status = rangeSummary(draft.start, draft.end, formatDate);
  if (!draft.start) status = 'Pick a start date';
  else if (!draft.end) status = `${formatDate(draft.start)} – pick an end date`;

  return (
    <div>
      <Calendar
        mode="range"
        numberOfMonths={narrow ? 1 : 2}
        weekStartsOn={1}
        today={today}
        selected={{ from: parseYmd(draft.start), to: parseYmd(draft.end) }}
        defaultMonth={parseYmd(start) ?? today}
        disabled={outsideLimits(min, max)}
        {...monthLimits(min, max, today)}
        // Our own rule for where the click lands (nextRangeDraft), not
        // react-day-picker's, which stretches a finished range instead.
        onSelect={(_range, day) => setDraft((current) => nextRangeDraft(current, toYmd(day)))}
      />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-deep-violet-blue/10 px-1.5 pt-1.5 pb-0.5">
        <p className="mr-auto text-xs text-ink-soft" aria-live="polite">
          {status}
        </p>
        {clearable && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
        <Button size="sm" disabled={!draft.start || !draft.end} onClick={() => onApply(draft)}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * Pick a start and end day in one control, in the style of the other
 * dropdowns (ui/Dropdown). Two variants, like ui/DatePicker:
 * - 'button' (default): the closed button reads "12 Mar – 30 Apr 2026" and
 *   opens the calendar. Takes the Dropdown `look`.
 * - 'input': two dd/mm/yyyy boxes in one field ("from – to") you can type
 *   into, each reported as soon as it is a whole date, with a calendar icon
 *   that opens the same calendar.
 *
 * In the calendar, the range only changes on Apply. Typed or picked, the end
 * can't be before the start, and `min` / `max` cap both ends.
 *
 * Not to be confused with ui/DateRangePicker: the older pair of separate
 * typed From / To fields this is meant to replace.
 *
 * @param {object} props
 * @param {string} props.start 'YYYY-MM-DD' or ''
 * @param {string} props.end 'YYYY-MM-DD' or ''
 * @param {(range: { start: string, end: string }) => void} props.onChange
 * @param {'button' | 'input'} [props.variant]
 * @param {string} [props.min] 'YYYY-MM-DD' or ''
 * @param {string} [props.max] 'YYYY-MM-DD' or ''
 * @param {string} [props.placeholder] button variant only
 * @param {'field' | 'filter' | 'compact'} [props.look] button variant only, see ui/Dropdown
 * @param {boolean} [props.clearable] a Clear button beside Apply (default true)
 * @param {boolean} [props.invalid] red border after a failed submit
 * @param {boolean} [props.disabled]
 * @param {string} [props.id] on the button / first text box, for a <label htmlFor>
 * @param {string} [props.ariaLabel]
 */
export default function RangeDatePicker({
  start,
  end,
  onChange,
  variant = 'button',
  min = '',
  max = '',
  placeholder = 'Select dates',
  look = 'field',
  clearable = true,
  invalid = false,
  disabled = false,
  id,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);

  const panel = (close) => (
    <RangePanel
      start={start}
      end={end}
      min={min}
      max={max}
      clearable={clearable}
      onApply={(range) => {
        onChange(range);
        close();
      }}
      onClear={() => {
        onChange({ start: '', end: '' });
        close();
      }}
    />
  );

  if (variant === 'input') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div className={cn(typedBoxClass, invalid && invalidInputClass)} role="group" aria-label={ariaLabel}>
          <DateInput
            id={id}
            value={start}
            min={min}
            max={minYmd(end, max)}
            disabled={disabled}
            ariaLabel="Start date"
            ariaInvalid={invalid}
            onChange={(value) => onChange({ start: value, end })}
            className={cn(typedInputClass, 'w-[10.5ch]')}
          />
          <span className="text-deep-violet-blue/45" aria-hidden="true">
            –
          </span>
          <DateInput
            value={end}
            min={maxYmd(start, min)}
            max={max}
            disabled={disabled}
            ariaLabel="End date"
            ariaInvalid={invalid}
            onChange={(value) => onChange({ start, end: value })}
            className={cn(typedInputClass, 'min-w-[10.5ch] flex-1')}
          />
          <PopoverTrigger disabled={disabled} aria-label="Open calendar" className={calendarIconClass}>
            <CalendarDays className="size-4" />
          </PopoverTrigger>
        </div>
        <PopoverContent align="end" className={calendarPanelClass}>
          {panel(() => setOpen(false))}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dropdown
      summary={rangeSummary(start, end, formatDate)}
      placeholder={placeholder}
      look={look}
      invalid={invalid}
      disabled={disabled}
      id={id}
      ariaLabel={ariaLabel}
      // Two months are wider than Dropdown's 28rem cap.
      panelClassName="max-w-[95vw]"
      listClassName="max-h-none p-1"
    >
      {(_query, close) => panel(close)}
    </Dropdown>
  );
}
