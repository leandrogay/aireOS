'use client';

import { useId } from 'react';

import Dropdown from '@/components/ui/Dropdown';
import { cn } from '@/lib/utils';

const checkRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';

/**
 * What the closed button says: the "all" label when nothing narrows the list,
 * the names when one or two are picked, and a count past that -- the full
 * list is in the button's tooltip. With `noneMeansAll` off, nothing picked is
 * '' so the button shows its placeholder.
 */
function summaryOf(options, values, allLabel, noneMeansAll) {
  const picked = options.filter((option) => values.includes(option.value));
  if (!picked.length && !noneMeansAll) return { text: '', all: false, full: '' };
  if (!picked.length || picked.length === options.length) return { text: allLabel, all: true, full: allLabel };
  const names = picked.map((option) => option.label);
  return {
    text: names.length <= 2 ? names.join(', ') : `${names.length} selected`,
    all: false,
    full: names.join(', '),
  };
}

/**
 * Pick any number of options from a list, on the shared ui/Dropdown shell
 * (ui/SelectDropdown is the pick-one version). The menu is a tick-box list
 * headed by an "All" row.
 *
 * Two meanings of "nothing ticked", picked with `noneMeansAll`:
 * - true (filters, the default): nothing ticked is "all". The "All" row is
 *   ticked then, and ticking every option by hand collapses back to [], so a
 *   filter that lets everything through is always [].
 * - false (a required form field): nothing ticked is nothing; the button
 *   shows `placeholder`, and the "All" row ticks or clears every option.
 *
 * `searchable` adds a search box for a long list; it matches an option's
 * label and its `hint` (a few words shown at the right of the row, e.g. a
 * store code).
 *
 * @param {{
 *   label?: string,
 *   ariaLabel?: string,
 *   options: Array<{ value: string, label: string, hint?: string }>,
 *   values: string[],
 *   onChange: (values: string[]) => void,
 *   allLabel?: string,
 *   noneMeansAll?: boolean,
 *   placeholder?: string,
 *   look?: 'field' | 'filter' | 'compact',
 *   searchable?: boolean,
 *   searchPlaceholder?: string,
 *   listClassName?: string,
 *   disabled?: boolean,
 *   invalid?: boolean,
 *   className?: string,
 * }} props
 */
export default function MultiSelectDropdown({
  label,
  ariaLabel,
  options,
  values,
  onChange,
  allLabel = 'All',
  noneMeansAll = true,
  placeholder = 'Select…',
  look = 'field',
  searchable = false,
  searchPlaceholder = 'Search…',
  listClassName,
  disabled = false,
  invalid = false,
  className,
}) {
  const labelId = useId();

  const summary = summaryOf(options, values, allLabel, noneMeansAll);
  const everything = options.length > 0 && options.every((option) => values.includes(option.value));
  const allTicked = everything || (noneMeansAll && values.length === 0);

  function toggle(value) {
    const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    onChange(noneMeansAll && next.length === options.length ? [] : next);
  }

  function toggleAll(checked) {
    if (noneMeansAll) onChange([]);
    else onChange(checked ? options.map((option) => option.value) : []);
  }

  return (
    <div className={cn('grid min-w-0 gap-1', className)}>
      {label && (
        <span id={labelId} className="text-xs font-medium text-deep-violet-blue/70">
          {label}
        </span>
      )}
      <Dropdown
        summary={options.length ? summary.text : ''}
        title={summary.full || undefined}
        placeholder={placeholder}
        look={look}
        // A filter narrowed to some options stands out, as FilterSelect's does.
        active={Boolean(summary.text) && !summary.all}
        disabled={disabled}
        invalid={invalid}
        ariaLabel={label ? undefined : ariaLabel}
        ariaLabelledby={label ? labelId : undefined}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        listClassName={listClassName}
      >
        {(query) => {
          const needle = query.trim().toLowerCase();
          const shown = needle
            ? options.filter((option) => `${option.label} ${option.hint || ''}`.toLowerCase().includes(needle))
            : options;

          return (
            <>
              {!needle && (
                <label className={cn(checkRowClass, 'font-medium')}>
                  <input
                    type="checkbox"
                    checked={allTicked}
                    onChange={(event) => toggleAll(event.target.checked)}
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
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="max-w-[45%] shrink-0 truncate text-[11px] text-deep-violet-blue/50">
                      {option.hint}
                    </span>
                  )}
                </label>
              ))}
              {!shown.length && <p className="px-2 py-1 text-sm text-deep-violet-blue/60">No matches</p>}
            </>
          );
        }}
      </Dropdown>
    </div>
  );
}
