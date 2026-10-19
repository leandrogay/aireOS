'use client';

import { useId, useRef, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const checkRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';

/**
 * What the closed button says: the "all" label when nothing narrows the list
 * (none ticked, or every one ticked), the names when one or two are, and a
 * count past that -- the full list is in the button's tooltip.
 */
function summaryOf(options, values, allLabel) {
  const picked = options.filter((option) => values.includes(option.value));
  if (!picked.length || picked.length === options.length) return { text: allLabel, all: true, full: allLabel };
  const names = picked.map((option) => option.label);
  return {
    text: names.length <= 2 ? names.join(', ') : `${names.length} selected`,
    all: false,
    full: names.join(', '),
  };
}

/**
 * Pick any number of options from a list, in a closed-by-default dropdown
 * whose menu is a tick-box list headed by an "All" row -- the look of the
 * promotion form's retailer and store pickers (components/promotions/
 * CheckboxDropdown), as a component any page can use.
 *
 * The selection is the parent's (`values`, `onChange`). Ticking "All" ticks
 * every option, unticking it clears them; nothing ticked and everything ticked
 * both read as the `allLabel`, which is what a filter means by "all". The
 * panel is a Popover, so a scrolling container never clips it and it flips
 * above the button when there is no room below. `searchable` adds a search box
 * for a long list.
 *
 * @param {{
 *   label?: string,
 *   options: Array<{ value: string, label: string }>,
 *   values: string[],
 *   onChange: (values: string[]) => void,
 *   allLabel?: string,
 *   placeholder?: string,
 *   searchable?: boolean,
 *   searchPlaceholder?: string,
 *   disabled?: boolean,
 *   invalid?: boolean,
 *   className?: string,
 * }} props
 */
export default function MultiSelectDropdown({
  label,
  options,
  values,
  onChange,
  allLabel = 'All',
  placeholder = 'Select…',
  searchable = false,
  searchPlaceholder = 'Search…',
  disabled = false,
  invalid = false,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const labelId = useId();

  const summary = summaryOf(options, values, allLabel);
  // A filter narrowed to some options stands out, as FilterSelect's does.
  const active = !summary.all;
  const everything = options.length > 0 && options.every((option) => values.includes(option.value));
  const shown = query.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  // Closing clears any search text, so the list opens whole next time.
  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setQuery('');
  }

  function toggle(value) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  return (
    <div className={cn('grid min-w-0 gap-1', className)}>
      {label && (
        <span id={labelId} className="text-xs font-medium text-deep-violet-blue/70">
          {label}
        </span>
      )}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={disabled}
          aria-labelledby={label ? labelId : undefined}
          title={summary.full}
          className={cn(
            'flex h-9 w-full min-w-0 items-center justify-between overflow-hidden rounded-md border bg-cream px-2.5 text-left text-sm text-deep-violet-blue focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
            active ? 'border-deep-violet-blue' : 'border-lavander',
            invalid && 'border-red-400 focus:border-red-500',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !options.length && 'text-deep-violet-blue/50')}>
            {options.length ? summary.text : placeholder}
          </span>
          <span className="ml-2 shrink-0 text-[10px] text-deep-violet-blue/50" aria-hidden="true">
            {open ? '▲' : '▼'}
          </span>
        </PopoverTrigger>
        {/* As wide as the button. The caret goes straight into the search box when there is one. */}
        <PopoverContent
          align="start"
          initialFocus={searchable ? searchRef : undefined}
          className="w-(--anchor-width) min-w-48 gap-0 overflow-hidden rounded-md border border-lavander bg-white p-0 text-deep-violet-blue ring-0"
        >
          {searchable && (
            <div className="border-b border-lavander p-2">
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                className="w-full rounded-md border border-lavander bg-cream px-2 py-1 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-52 overflow-auto p-2">
            {!query.trim() && (
              <label className={cn(checkRowClass, 'font-medium')}>
                <input
                  type="checkbox"
                  checked={everything}
                  onChange={(event) => onChange(event.target.checked ? options.map((option) => option.value) : [])}
                  className="size-3.5 accent-deep-violet-blue"
                />
                {allLabel}
              </label>
            )}
            {shown.map((option) => (
              <label key={option.value} className={checkRowClass}>
                <input
                  type="checkbox"
                  checked={values.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
            {!shown.length && <p className="px-2 py-1 text-sm text-deep-violet-blue/60">No matches</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
