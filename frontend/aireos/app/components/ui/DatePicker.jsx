'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DateInput } from '@/components/ui/DateRangePicker';
import Dropdown from '@/components/ui/Dropdown';
import { inputClass, invalidInputClass } from '@/components/ui/formStyles';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { monthLimits, outsideLimits, parseYmd, toYmd } from '@/app/utils/datePicker';
import { formatDate } from '@/lib/formatDate';
import { singaporeToday } from '@/lib/singaporeTime';
import { cn } from '@/lib/utils';

// The calendar panel, shared with ui/RangeDatePicker's typed variant.
export const calendarPanelClass =
  'aire-glass-dropdown-panel w-auto max-w-[95vw] gap-0 overflow-hidden rounded-md border border-lavander p-1 text-deep-violet-blue ring-0';

// The typed variants' box: the form input look around a dd/mm/yyyy text box
// and the calendar icon, so it lines up with a Dropdown 'field' beside it.
export const typedBoxClass = cn(
  inputClass,
  'flex items-center gap-1 py-0 pr-1 focus-within:border-violet has-disabled:opacity-60',
);
export const typedInputClass = 'h-8 bg-transparent tabular-nums outline-none disabled:cursor-not-allowed';
export const calendarIconClass =
  'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-deep-violet-blue/50 hover:bg-lavander/50 hover:text-deep-violet-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:hover:bg-transparent';

/**
 * One month grid with a month/year dropdown, opening on the picked day's
 * month (or today's). A click reports that day, even the one already picked.
 *
 * @param {{ value: string, min?: string, max?: string, onPick: (ymd: string) => void }} props
 */
function DayCalendar({ value, min, max, onPick }) {
  const today = singaporeToday();
  const selected = parseYmd(value);
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      weekStartsOn={1}
      today={today}
      selected={selected}
      defaultMonth={selected ?? today}
      disabled={outsideLimits(min, max)}
      {...monthLimits(min, max, today)}
      // The day clicked, not `selected`: clicking the picked day again would
      // otherwise report undefined (react-day-picker deselects it).
      onSelect={(_selected, day) => onPick(toYmd(day))}
    />
  );
}

/**
 * Pick one day, in the style of the other dropdowns (ui/Dropdown). Two
 * variants:
 * - 'button' (default): the closed button reads "12 Mar 2026" and opens the
 *   calendar, like ui/MonthDropdown does for months. Takes the Dropdown
 *   `look` ('field' | 'filter' | 'compact').
 * - 'input': a dd/mm/yyyy box you can type into (ui/DateRangePicker's
 *   DateInput), with a calendar icon that opens the same calendar.
 *
 * The value is 'YYYY-MM-DD' or ''. `min` / `max` grey out days outside them
 * and also limit typing. Weeks start on Monday and today (Singapore) is bold.
 *
 * @param {object} props
 * @param {string} props.value 'YYYY-MM-DD' or ''
 * @param {(value: string) => void} props.onChange
 * @param {'button' | 'input'} [props.variant]
 * @param {string} [props.min] 'YYYY-MM-DD' or ''
 * @param {string} [props.max] 'YYYY-MM-DD' or ''
 * @param {string} [props.placeholder] button variant only
 * @param {'field' | 'filter' | 'compact'} [props.look] button variant only, see ui/Dropdown
 * @param {boolean} [props.clearable] button variant: a Clear row under the calendar
 * @param {boolean} [props.invalid] red border after a failed submit
 * @param {boolean} [props.disabled]
 * @param {string} [props.id] on the button / text box, for a <label htmlFor>
 * @param {string} [props.ariaLabel]
 * @param {string} [props.boxClassName] input variant: extra classes on the box (e.g. a filter card's white look)
 */
export default function DatePicker({
  value,
  onChange,
  variant = 'button',
  min = '',
  max = '',
  placeholder = 'Select date',
  look = 'field',
  clearable = false,
  invalid = false,
  disabled = false,
  id,
  ariaLabel,
  boxClassName,
}) {
  const [open, setOpen] = useState(false);

  if (variant === 'input') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div className={cn(typedBoxClass, boxClassName, invalid && invalidInputClass)}>
          <DateInput
            id={id}
            value={value}
            min={min}
            max={max}
            disabled={disabled}
            ariaLabel={ariaLabel}
            ariaInvalid={invalid}
            onChange={onChange}
            className={cn(typedInputClass, 'min-w-0 flex-1')}
          />
          <PopoverTrigger disabled={disabled} aria-label="Open calendar" className={calendarIconClass}>
            <CalendarDays className="size-4" />
          </PopoverTrigger>
        </div>
        <PopoverContent align="end" className={calendarPanelClass}>
          <DayCalendar
            value={value}
            min={min}
            max={max}
            onPick={(day) => {
              onChange(day);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dropdown
      summary={value ? formatDate(value) : ''}
      placeholder={placeholder}
      look={look}
      invalid={invalid}
      disabled={disabled}
      id={id}
      ariaLabel={ariaLabel}
      listClassName="max-h-none p-1"
      footer={
        clearable && value
          ? (_query, close) => (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  onChange('');
                  close();
                }}
              >
                Clear
              </Button>
            )
          : undefined
      }
    >
      {(_query, close) => (
        <DayCalendar
          value={value}
          min={min}
          max={max}
          onPick={(day) => {
            onChange(day);
            close();
          }}
        />
      )}
    </Dropdown>
  );
}
