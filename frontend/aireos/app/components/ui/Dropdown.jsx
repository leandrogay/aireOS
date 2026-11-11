'use client';

import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { filterControlClass } from '@/components/ui/filterControl';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * The closed button's look, one per kind of place a dropdown sits:
 * - field: forms and the mapping review (cream, lavender border). `size`
 *   'sm' is the compact version used inside tables.
 * - filter: a FilterBar (filterControl.js), shared with FilterSelect, with
 *   the darker border while `active`.
 * - compact: the inventory filter card (white, violet border, small text).
 * - outline: beside outline Buttons in a toolbar or footer (TablePagination's
 *   rows per page): the outline Button's own height, border, radius and hover,
 *   so the two read as one row of controls.
 *
 * @param {'field' | 'filter' | 'compact' | 'outline'} look
 * @param {'md' | 'sm'} size
 * @param {boolean} active
 */
function lookClass(look, size, active) {
  if (look === 'filter') return filterControlClass(active);
  if (look === 'compact') return 'h-8 rounded-md border border-deep-violet-blue/45 bg-white px-2 text-xs';
  if (look === 'outline') {
    // Mirrors ui/button's outline variant at its default size (h-8).
    return 'h-8 rounded-lg border border-deep-violet-blue/30 bg-white px-2.5 text-sm transition-colors hover:bg-cream aria-expanded:bg-cream focus-visible:border-violet focus-visible:ring-3 focus-visible:ring-violet/40';
  }
  return cn(
    'rounded-md border border-lavander bg-cream focus:border-violet',
    size === 'sm' ? 'h-7 px-2 text-xs' : 'px-2.5 py-1.5 text-sm',
  );
}

/**
 * The one dropdown shell every picker is built on: ui/SelectDropdown (pick
 * one), ui/MultiSelectDropdown (pick many) and ui/MonthDropdown (a month
 * grid). It owns the closed button, the panel, open/close and the optional
 * search box; what goes in the panel is the caller's.
 *
 * The panel is a Popover, so it renders in a portal: a scrolling container
 * never clips it, and it flips above the button when there is no room below.
 * It is at least as wide as the button and grows (up to 28rem) for long
 * labels. Clicking outside or Escape closes it, and closing clears the search.
 *
 * Children may be a function `(query, close) => nodes` so the caller can
 * filter its rows by the search text, or close the panel after a pick.
 * `footer` (same shape) is pinned under the list, outside its scroll.
 *
 * @param {object} props
 * @param {string} props.summary text on the closed button ('' shows `placeholder`)
 * @param {string} [props.placeholder]
 * @param {string} [props.title] tooltip on the closed button; defaults to `summary`
 * @param {'field' | 'filter' | 'compact' | 'outline'} [props.look]
 * @param {'md' | 'sm'} [props.size] only for the field look
 * @param {boolean} [props.active] filter look: darker border while narrowing a list
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.invalid] red border after a failed submit
 * @param {string} [props.id] on the button, for a <label htmlFor>
 * @param {string} [props.ariaLabel]
 * @param {string} [props.ariaLabelledby]
 * @param {string} [props.className] extra classes for the button
 * @param {boolean} [props.searchable]
 * @param {string} [props.searchPlaceholder]
 * @param {(query: string) => void} [props.onSearchChange]
 * @param {string} [props.panelClassName]
 * @param {string} [props.listClassName] e.g. 'max-h-none' to show every row
 * @param {string} [props.listRole] e.g. 'listbox'; labelled with `ariaLabel`
 * @param {React.ReactNode | ((query: string, close: () => void) => React.ReactNode)} [props.footer]
 * @param {React.ReactNode | ((query: string, close: () => void) => React.ReactNode)} props.children
 */
export default function Dropdown({
  summary,
  placeholder = 'Select…',
  title,
  look = 'field',
  size = 'md',
  active = false,
  disabled = false,
  invalid = false,
  id,
  ariaLabel,
  ariaLabelledby,
  className,
  searchable = false,
  searchPlaceholder = 'Search…',
  onSearchChange,
  panelClassName,
  listClassName,
  listRole,
  footer,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setQuery('');
  }

  const close = () => handleOpenChange(false);
  const render = (slot) => (typeof slot === 'function' ? slot(query, close) : slot);
  const small = look === 'compact' || size === 'sm';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        title={title ?? (summary || undefined)}
        className={cn(
          'aire-glass-control flex w-full min-w-0 cursor-pointer items-center justify-between overflow-hidden text-left text-deep-violet-blue outline-none disabled:cursor-not-allowed disabled:opacity-60',
          lookClass(look, size, active),
          invalid && 'border-red-400 focus:border-red-500',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !summary && 'text-deep-violet-blue/50')}>
          {summary || placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'ml-2 shrink-0 text-deep-violet-blue/50 transition-transform',
            small ? 'size-3.5' : 'size-4',
            open && 'rotate-180',
          )}
        />
      </PopoverTrigger>
      {/* The caret goes straight into the search box when there is one. */}
      <PopoverContent
        align="start"
        initialFocus={searchable ? searchRef : undefined}
        className={cn(
          'aire-glass-dropdown-panel w-max min-w-(--anchor-width) max-w-[min(28rem,90vw)] gap-0 overflow-hidden rounded-md border border-lavander bg-white p-0 text-deep-violet-blue ring-0',
          panelClassName,
        )}
      >
        {searchable && (
          <div className="border-b border-lavander p-2">
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value);
                onSearchChange?.(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              className="w-full rounded-md border border-lavander bg-cream px-2 py-1 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none"
            />
          </div>
        )}
        <div
          role={listRole}
          aria-label={listRole ? ariaLabel : undefined}
          className={cn('max-h-72 overflow-y-auto overflow-x-hidden p-1.5', listClassName)}
        >
          {render(children)}
        </div>
        {footer && <div className="border-t border-lavander p-1.5">{render(footer)}</div>}
      </PopoverContent>
    </Popover>
  );
}
