'use client';

import { useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const SIZES = {
  md: 'h-9 px-2.5 text-sm',
  sm: 'h-7 px-2 text-xs',
};

/**
 * Pick one option from a list, in the dropdown style of the promotion form's
 * pickers (cream button, ▼/▲, white panel; components/ui/MultiSelectDropdown
 * is the pick-many version). The panel closes on a pick, and is a Popover,
 * so a scrolling container never clips it.
 *
 * Options come as `options`, or as `groups` with a heading each ("Columns not
 * used yet"). An option can be `disabled`, with a `hint` saying why. A
 * `hint` is a few words beside the label; a `description` is a sentence under
 * it, wrapped, for a list whose options need explaining. The
 * button shows the picked option's label, or `placeholder` when `value`
 * matches none -- which is also how an action menu works: keep `value` at ''
 * and the button keeps saying "Map to…" after every pick.
 *
 * `action` pins one more row under the list -- "+ Create new customer" --
 * for when what is wanted is not in it. It is called with whatever was typed
 * in the search box, and `label` may be a function of that text, so a search
 * with no match can offer to create exactly that.
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   options?: Array<{ value: string, label: string, disabled?: boolean, hint?: string, description?: string }>,
 *   groups?: Array<{ label?: string, options: Array<{ value: string, label: string, disabled?: boolean, hint?: string, description?: string }> }>,
 *   placeholder?: string,
 *   ariaLabel?: string,
 *   searchable?: boolean,
 *   searchPlaceholder?: string,
 *   size?: 'md' | 'sm',
 *   disabled?: boolean,
 *   invalid?: boolean,
 *   id?: string,
 *   className?: string,
 *   triggerClassName?: string,
 *   action?: { label: string | ((query: string) => string), onSelect: (query: string) => void },
 * }} props
 */
export default function SelectDropdown({
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select…',
  ariaLabel,
  searchable = false,
  searchPlaceholder = 'Search…',
  size = 'md',
  disabled = false,
  invalid = false,
  id,
  className,
  triggerClassName,
  action,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const allGroups = (groups || [{ options: options || [] }]).filter((group) => group.options.length);
  const current = allGroups.flatMap((group) => group.options).find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const shown = allGroups
    .map((group) => ({
      ...group,
      options: needle ? group.options.filter((option) => option.label.toLowerCase().includes(needle)) : group.options,
    }))
    .filter((group) => group.options.length);

  // Closing clears any search text, so the list opens whole next time.
  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setQuery('');
  }

  function pick(option) {
    handleOpenChange(false);
    if (option.value !== value) onChange(option.value);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        title={current?.label || undefined}
        className={cn(
          'flex w-full min-w-0 items-center justify-between overflow-hidden rounded-md border border-lavander bg-cream text-left text-deep-violet-blue focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          SIZES[size],
          invalid && 'border-red-400 focus:border-red-500',
          className,
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-deep-violet-blue/50')}>
          {current ? current.label : placeholder}
        </span>
        <span className="ml-2 shrink-0 text-[10px] text-deep-violet-blue/50" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </PopoverTrigger>
      {/* At least as wide as the button; wider when it is a small one. */}
      <PopoverContent
        align="start"
        initialFocus={searchable ? searchRef : undefined}
        className="w-auto min-w-(--anchor-width) max-w-[min(28rem,90vw)] gap-0 overflow-hidden rounded-md border border-lavander bg-white p-0 text-deep-violet-blue ring-0"
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
        <div role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto overflow-x-hidden p-1.5">
          {shown.map((group, index) => (
            <div key={group.label || index} className={cn(index > 0 && 'mt-1 border-t border-lavander pt-1')}>
              {group.label && (
                <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-deep-violet-blue/60">{group.label}</p>
              )}
              {group.options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={`${option.value}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    onClick={() => pick(option)}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-deep-violet-blue outline-none hover:bg-cream focus-visible:bg-cream disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                      selected && 'font-medium',
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn('size-3.5 shrink-0 self-start', option.description && 'mt-0.5', selected ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {/* A hint gives way before the label does, so a long
                            one can never squeeze the label to "T…". */}
                        {option.hint && (
                          <span className="max-w-[45%] truncate text-[11px] text-deep-violet-blue/50" title={option.hint}>
                            {option.hint}
                          </span>
                        )}
                      </span>
                      {option.description && (
                        <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-deep-violet-blue/55">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!shown.length && <p className="px-2 py-1 text-sm text-deep-violet-blue/60">No matches</p>}
        </div>
        {/* Pinned under the list, so it is there whatever the list scrolls to:
            the way out when what is wanted is not in it. */}
        {action && (
          <div className="border-t border-lavander p-1.5">
            <button
              type="button"
              onClick={() => {
                const typed = query.trim();
                handleOpenChange(false);
                action.onSelect(typed);
              }}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium text-deep-violet-blue outline-none hover:bg-cream focus-visible:bg-cream"
            >
              <Plus aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {typeof action.label === 'function' ? action.label(query.trim()) : action.label}
              </span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
