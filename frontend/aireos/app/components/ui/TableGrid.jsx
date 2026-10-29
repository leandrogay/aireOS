'use client';

import { cn } from '@/lib/utils';
import SortHeader, { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import TableSkeleton from '@/components/ui/TableSkeleton';

// The "..." column every list table ends with (RowActions). Its header is
// only for screen readers.
export const ACTIONS_COLUMN = { key: 'actions', label: 'Actions', width: '4.5rem', hideLabel: true };

// How far a nested table's edges sit inside its parent table's edges, for
// `inset`. ExpandableRow's details cell (px-4) plus the nested frame's 1px
// border; the standard card (p-3, cardClass) plus the same border.
export const EXPANDED_ROW_INSET = '1rem + 1px';
export const CARD_INSET = '0.75rem + 1px';

// `card` sits flush inside DataTable and scrolls both ways under a sticky
// header; `nested` is a bordered table inside an expanded row or a card.
const FRAMES = {
  card: 'min-h-0 flex-1 overflow-auto border-t border-lavander',
  nested: 'overflow-x-auto rounded-md border border-lavander bg-white',
};
const HEADER_ROW_HEIGHTS = { card: 'h-10', nested: 'h-9' };

/**
 * Width of one column. A table inset from its parent's edges by `inset` (a
 * CSS length sum) takes that off its first and last columns, so its column
 * boundaries land exactly on the parent's.
 *
 * @param {string | undefined} width
 * @param {boolean} isEdge
 * @param {string | undefined} inset
 * @returns {object | undefined}
 */
function columnStyle(width, isEdge, inset) {
  if (!width) return undefined;
  return { width: inset && isEdge ? `calc(${width} - (${inset}))` : width };
}

/**
 * The `<table>` of every list table, in the promotions/customers look,
 * declared by its columns:
 *
 *   <TableGrid columns={[
 *     { key: 'name', label: 'Customer', width: '18rem' },
 *     { key: 'retailers', label: 'Retailers' },
 *     { key: 'start', label: 'Start date', width: '8rem', sortField: 'period_start' },
 *     ACTIONS_COLUMN,
 *   ]}>
 *     {rows}
 *   </TableGrid>
 *
 * Any column with a `width` makes the table `table-fixed`: those widths are
 * kept whatever the rows hold (cells truncate, with a `title`), and columns
 * without one share the rest. So filtering, searching or paging never makes
 * the columns jump, and two tables declared with the same widths line up,
 * nested or not (`inset`).
 *
 * A column with `sortField` gets a SortHeader driven by `sort` / `onSort`.
 * `align: 'right'` right-aligns the header, for numeric columns; the rows'
 * cells pair it with `text-right tabular-nums` so the digits line up.
 * `isLoading` (first load only) shows placeholder rows; `emptyState` replaces
 * the rows with a centred message, e.g. "No promotions match these filters".
 * DataTable wraps this in the standard card; use it alone for a nested table.
 *
 * @param {{
 *   columns: Array<{ key: string, label: string, width?: string, sortField?: string, hideLabel?: boolean, align?: 'left' | 'right' }>,
 *   children?: import('react').ReactNode,
 *   variant?: 'card' | 'nested',
 *   minWidth?: string,
 *   inset?: string,
 *   sort?: { field: string | null, direction: 'asc' | 'desc' },
 *   onSort?: (field: string) => void,
 *   isLoading?: boolean,
 *   skeletonRows?: number,
 *   emptyState?: import('react').ReactNode,
 * }} props
 */
export default function TableGrid({
  columns,
  children,
  variant = 'card',
  minWidth,
  inset,
  sort,
  onSort,
  isLoading = false,
  skeletonRows = 6,
  emptyState = null,
}) {
  const isFixed = columns.some((column) => column.width);
  const lastIndex = columns.length - 1;

  return (
    // relative: the header's sr-only labels are absolutely positioned;
    // without a positioned ancestor they escape this scroll box and widen
    // the whole page on narrow windows.
    <div className={cn('relative', FRAMES[variant])}>
      <table
        style={minWidth ? { minWidth } : undefined}
        className={cn(
          'w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle',
          isFixed && 'table-fixed',
        )}
      >
        {isFixed && (
          <colgroup>
            {columns.map((column, index) => (
              <col
                key={column.key}
                style={columnStyle(column.width, index === 0 || index === lastIndex, inset)}
              />
            ))}
          </colgroup>
        )}
        {/* Stays in view while the rows scroll. White under the cream tint
            so rows do not show through; the bottom rule is an inset shadow
            because a collapsed table border does not move with a sticky
            header. */}
        <thead className="sticky top-0 z-10 bg-white">
          <tr
            className={cn(
              'bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]',
              HEADER_ROW_HEIGHTS[variant],
            )}
          >
            {columns.map((column) => {
              const alignClass = column.align === 'right' ? 'text-right' : undefined;
              if (column.hideLabel) {
                return (
                  <th key={column.key} scope="col" className="px-2 py-2">
                    <span className="sr-only">{column.label}</span>
                  </th>
                );
              }
              if (column.sortField) {
                return (
                  <SortHeader
                    key={column.key}
                    label={column.label}
                    field={column.sortField}
                    sortField={sort?.field ?? null}
                    sortDirection={sort?.direction ?? 'asc'}
                    onSort={onSort}
                    className={alignClass}
                  />
                );
              }
              return (
                <th key={column.key} scope="col" className={cn(TABLE_HEADER_CLASS, alignClass)}>
                  {column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody aria-busy={isLoading}>
          {isLoading && <TableSkeleton columns={columns.length} rows={skeletonRows} />}
          {emptyState ? (
            <tr>
              <td colSpan={columns.length} className="whitespace-normal px-4 py-24 text-center text-deep-violet-blue/80">
                {emptyState}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
