'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Search box for a list table's toolbar. Filtering happens in the parent as
 * you type; the rows are already loaded, so there is no submit. `className`
 * sizes the box in a crowded toolbar (e.g. `min-w-40 flex-1 max-w-64` to
 * shrink before it wraps).
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   label: string,
 *   placeholder?: string,
 *   className?: string,
 * }} props
 */
export default function TableSearch({ value, onChange, label, placeholder = 'Search…', className }) {
  return (
    <label className={cn('relative', className)}>
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
        className="h-9 w-64 max-w-full rounded-lg border border-lavander bg-white pl-8 pr-2.5 text-sm text-deep-violet-blue outline-none placeholder:text-deep-violet-blue/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}
