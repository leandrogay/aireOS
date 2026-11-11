'use client';

import { Search } from 'lucide-react';

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
        className="h-9 w-full min-w-0 rounded-glass-sm border border-deep-violet-blue/60 bg-white pl-8 pr-2.5 text-sm text-deep-violet-blue outline-none transition-[border-color] duration-hover placeholder:text-ink-soft hover:border-deep-violet-blue/75 focus-ring sm:w-64"
      />
    </label>
  );
}
