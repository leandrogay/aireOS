'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';

// Shared by every header cell of the list tables (promotions, uploads,
// mappings), sortable or not, so the columns line up and read the same.
export const TABLE_HEADER_CLASS = 'px-4 py-2.5 text-xs font-medium text-ink-soft';
export const TABLE_HEADER_ACTION_CLASS =
  'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-sm bg-transparent py-1 text-xs font-medium text-ink-soft outline-none transition-colors duration-hover hover:text-deep-violet-blue focus-ring';

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
          TABLE_HEADER_ACTION_CLASS,
          active && 'text-deep-violet-blue',
        )}
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </th>
  );
}
