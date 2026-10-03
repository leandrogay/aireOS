'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';

// Shared by every header cell of the list tables (promotions, uploads,
// mappings), sortable or not, so the columns line up and read the same.
export const TABLE_HEADER_CLASS = 'px-4 py-2.5 text-xs font-medium text-deep-violet-blue/60';

/**
 * Column header that sorts on press. The parent owns the sort state; pressing
 * the active column again is expected to flip its direction (nextSort() in
 * app/utils/tableView.js).
 *
 * @param {{
 *   label: string,
 *   field: string,
 *   sortField: string | null,
 *   sortDirection: 'asc' | 'desc',
 *   onSort: (field: string) => void,
 *   className?: string,
 * }} props
 */
export default function SortHeader({ label, field, sortField, sortDirection, onSort, className }) {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
  const ariaSort = !active ? 'none' : sortDirection === 'asc' ? 'ascending' : 'descending';

  return (
    <th scope="col" aria-sort={ariaSort} className={cn(TABLE_HEADER_CLASS, className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md outline-none transition-colors hover:text-deep-violet-blue focus-visible:ring-3 focus-visible:ring-ring/50',
          active && 'text-deep-violet-blue',
        )}
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </th>
  );
}
