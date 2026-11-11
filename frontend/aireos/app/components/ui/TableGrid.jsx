'use client';

import { cn } from '@/lib/utils';
import SortHeader, { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import TableSkeleton from '@/components/ui/TableSkeleton';

// The "..." column every list table ends with (RowActions). Its header is
// only for screen readers.
export const ACTIONS_COLUMN = { key: 'actions', label: 'Actions', width: '4.5rem', hideLabel: true };

// How far a nested table's edges sit inside its parent table's edges, for
// `inset`. ExpandableRow's details cell (px-4) plus the nested frame's 1px
// border; the standard card (p-4, cardClass) plus the same border.
export const EXPANDED_ROW_INSET = '1rem + 1px';
export const CARD_INSET = '0.75rem + 1px';

// `card` sits flush inside DataTable and scrolls both ways under a sticky
// header (the card's own overflow-hidden rounds its corners); `nested` is a
// bordered table inside an expanded row or a card, on the control radius and
// the card's hairline. Its own overflow clips the cream header to its corners.
const FRAMES = {
  card: 'min-h-0 flex-1 overflow-auto border-t border-lavander',
  nested: 'overflow-x-auto rounded-glass-sm border border-(--aire-card-border) bg-white',
};
const HEADER_ROW_HEIGHTS = { card: 'h-10', nested: 'h-9' };

// A column with `hideBelow` drops out under that viewport width, so a wide
// table fits instead of scrolling sideways. The Tailwind breakpoints, plus
// pixel widths for a table with several columns to drop in turn. Whole class
// names, so Tailwind finds them; the rows' cells must carry the same class
// (hideClass).
const HIDE_BELOW = {
  md: 'max-md:hidden',
  lg: 'max-lg:hidden',
  xl: 'max-xl:hidden',
  '960px': 'max-[959px]:hidden',
  '1024px': 'max-[1023px]:hidden',
  '1100px': 'max-[1099px]:hidden',
  '1280px': 'max-[1279px]:hidden',
};

/**
 * The class a column's header, <col> and cells share to hide below its
 * `hideBelow` width (a key of HIDE_BELOW); undefined for a column that
 * always shows.
 *
 * @param {{ hideBelow?: string }} column
 * @returns {string | undefined}
 */
export function hideClass(column) {
  return HIDE_BELOW[column.hideBelow];
}

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
 * `hideBelow` (a key of HIDE_BELOW) hides a column (header, <col> and, through
 * hideClass, the rows' cells) under that breakpoint or pixel width (HIDE_BELOW).
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
    <div className={cn('relative min-w-0 max-w-full', FRAMES[variant])}>
      <table
        style={minWidth ? { minWidth } : undefined}
        className={cn(
          'aire-table-grid w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle',
          isFixed && 'table-fixed',
        )}
      >
        {isFixed && (
          <colgroup>
            {columns.map((column, index) => (
              <col
                key={column.key}
                className={hideClass(column)}
                style={columnStyle(column.width, index === 0 || index === lastIndex, inset)}
              />
            ))}
          </colgroup>
        )}
        {/* Stays in view while the rows scroll. Solid cream over the rows
            so rows do not show through (never glass); the bottom rule is an
            inset shadow because a collapsed table border does not move with
            a sticky header. The card's hairline colour, so it shows on cream. */}
        <thead className="sticky top-0 z-10 bg-cream">
          <tr
            className={cn(
              'bg-cream [&>th]:shadow-[inset_0_-1px_0_var(--aire-card-border)]',
              HEADER_ROW_HEIGHTS[variant],
            )}
          >
            {columns.map((column) => {
              const alignClass = cn(column.align === 'right' && 'text-right', hideClass(column));
              if (column.hideLabel) {
                return (
                  <th key={column.key} scope="col" className={cn('px-2 py-2', hideClass(column))}>
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
          {isLoading && (
            <TableSkeleton
              columns={columns.length}
              rows={skeletonRows}
              columnClassNames={columns.map(hideClass)}
            />
          )}
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
