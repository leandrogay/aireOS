'use client';

import { Search, X } from 'lucide-react';

/**
 * Search box for a list table's toolbar. Filtering happens in the parent as
 * you type; the rows are already loaded, so there is no submit.
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   label: string,
 *   placeholder?: string,
 * }} props
 */
export default function TableSearch({ value, onChange, label, placeholder = 'Search…' }) {
  return (
    <label className="relative min-w-0 flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-deep-violet-blue/50"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        // The browser's own clear button doesn't match the lucide icons, so it
        // is hidden and replaced by the X button below.
        className="h-9 w-full min-w-0 rounded-lg border border-lavander bg-white pl-8 pr-8 text-sm text-deep-violet-blue outline-none placeholder:text-deep-violet-blue/40 focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-64 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-deep-violet-blue/50 hover:bg-lavander/50 hover:text-deep-violet-blue focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </label>
  );
}
