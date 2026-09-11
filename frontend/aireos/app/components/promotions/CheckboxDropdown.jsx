'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Closed-by-default dropdown whose menu is a checkbox list.
 *
 * The trigger looks like the other cream/lavender inputs. Clicking it opens
 * the panel; clicking outside closes it. Selection stays in the parent —
 * this component only controls open/close.
 *
 * When searchable, children may be a function `(query) => nodes` so the
 * parent can filter its checkbox rows. The query is cleared on close.
 *
 * @param {object} props
 * @param {string} props.summary text shown on the closed button
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.searchable]
 * @param {string} [props.searchPlaceholder]
 * @param {React.ReactNode | ((query: string) => React.ReactNode)} props.children
 */
export default function CheckboxDropdown({
  summary,
  placeholder = 'Select…',
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  children,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  /**
   * Close the menu and clear any search text.
   */
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  /**
   * Close the menu when the pointer lands outside this dropdown.
   */
  useEffect(() => {
    /**
     * @param {MouseEvent} event
     */
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        close();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [close]);

  /**
   * Put the caret in the search box as soon as the panel opens.
   */
  useEffect(() => {
    if (open && searchable) {
      searchRef.current?.focus();
    }
  }, [open, searchable]);

  const content = typeof children === 'function' ? children(query) : children;

  return (
    <div ref={rootRef} className="relative w-full min-w-0 max-w-full">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        title={summary || undefined}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
        }}
        className="flex w-full min-w-0 max-w-full items-center justify-between overflow-hidden rounded-md border border-lavander bg-cream px-2.5 py-1 text-left text-sm text-deep-violet-blue focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`min-w-0 flex-1 truncate ${summary ? '' : 'text-deep-violet-blue/50'}`}>
          {summary || placeholder}
        </span>
        <span className="ml-2 shrink-0 text-[10px] text-deep-violet-blue/50" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-lavander bg-white shadow-md">
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
                  if (event.key === 'Enter') {
                    event.preventDefault();
                  }
                }}
                className="w-full rounded-md border border-lavander bg-cream px-2 py-1 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-52 overflow-auto p-2">{content}</div>
        </div>
      )}
    </div>
  );
}
