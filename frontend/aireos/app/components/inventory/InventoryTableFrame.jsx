'use client';

import { useState } from 'react';

import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import { Button } from '@/components/ui/button';
import { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import TablePagination from '@/components/ui/TablePagination';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import { monthCheckboxOptions } from '@/app/utils/inventoryForm';
import { paginate, resultCountLabel } from '@/app/utils/tableView';
import { cn } from '@/lib/utils';

// The same look as the list tables on Customers, Promotions and SKUs
// (ui/DataTable + ui/TableGrid), so every table in the app reads alike.
const actionButtonClass = 'rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream';

export const inventoryTableClass = 'aire-table-rows w-full text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle';
// Solid cream keeps rows from showing through the sticky header;
// the bottom rule is an inset shadow because a collapsed border does not move
// with a sticky header (same as TableGrid).
export const inventoryTheadClass = 'sticky top-0 z-10 bg-cream';
export const inventoryHeadRowClass = 'h-10 bg-cream [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]';
export const inventoryThClass = TABLE_HEADER_CLASS;
export const inventoryTdClass = 'px-4 py-2.5 text-deep-violet-blue';
export const inventoryRowClass = 'border-b border-lavander/80';

/**
 * Placeholder rows for an inventory table's first load, sized like the real
 * rows (inventoryRowClass / inventoryTdClass) so nothing moves when they arrive.
 *
 * @param {{ columns: number }} props
 */
export function InventoryTableSkeleton({ columns }) {
  return <TableSkeleton columns={columns} rows={5} className="h-10 bg-white" cellClassName="px-4 py-2.5" />;
}

/**
 * Table shell shared by the inventory tabs, in the list-table look (see
 * ui/DataTable): the title and row count, Clear, Expand/Collapse, and the
 * month checkbox filter, with the table flush to the card's edges. `children` draws the columns
 * for the rows still showing, and places `monthHeader` on the Month column.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {object[]} props.rows rows before the month filter
 * @param {string} [props.description]
 * @param {boolean} [props.loading] first load in flight: the row count shows a
 *   placeholder, and `children` should draw InventoryTableSkeleton rows
 * @param {(visible: object[], monthHeader: import('react').ReactNode) => import('react').ReactNode} props.children
 */
export default function InventoryTableFrame({ title, rows, description, loading = false, children }) {
  const [expanded, setExpanded] = useState(false);
  const [monthFilter, setMonthFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const monthOptions = monthCheckboxOptions(rows);
  const knownMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => knownMonths.has(value));
  const visible = activeMonthFilter.length
    ? rows.filter((row) => activeMonthFilter.includes(row.month.slice(0, 7)))
    : rows;
  const { pageRows, currentPage, totalPages } = paginate(visible, page, pageSize);

  function clearMonthFilter() {
    setMonthFilter([]);
    setOpenFilter(null);
    setPage(1);
  }

  const monthHeader = (
    <th className="px-3 py-1.5">
      <HeaderCheckboxFilter
        id="month"
        label="Month"
        selected={activeMonthFilter}
        options={monthOptions}
        openId={openFilter}
        setOpenId={setOpenFilter}
        onChange={(months) => {
          setMonthFilter(months);
          setPage(1);
        }}
      />
    </th>
  );

  return (
    <section aria-label={title} className={cn(glassSurfaceClass, 'flex flex-col overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-baseline gap-2 text-sm">
            <h3 className="font-medium text-deep-violet-blue">{title}</h3>
            {loading ? (
              <Skeleton aria-hidden="true" className="h-3 w-20 rounded bg-lavander" />
            ) : (
              <span className="text-deep-violet-blue/70" aria-live="polite">
                {resultCountLabel(visible.length, rows.length, 'row')}
              </span>
            )}
          </div>
          {description ? (
            <p className="mt-1 max-w-3xl text-xs text-deep-violet-blue/60">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearMonthFilter}
            disabled={activeMonthFilter.length === 0}
            className={actionButtonClass}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((current) => !current)}
            className={actionButtonClass}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </div>

      <div className={cn('overflow-auto border-t border-lavander', !expanded && 'max-h-[28vh]')}>
        {children(pageRows, monthHeader)}
      </div>
      {!loading && visible.length > 0 && (
        <TablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={visible.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </section>
  );
}
