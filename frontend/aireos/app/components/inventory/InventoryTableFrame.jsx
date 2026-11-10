'use client';

import { useState } from 'react';

import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import { monthCheckboxOptions } from '@/app/utils/inventoryForm';
import { paginate, resultCountLabel } from '@/app/utils/tableView';

// The same look as the list tables on Customers, Promotions and SKUs
// (ui/DataTable + ui/TableGrid), so every table in the app reads alike.
export const inventoryTableClass = 'aire-table-rows w-full text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle';
// Solid cream keeps rows from showing through the sticky header;
// the bottom rule is an inset shadow because a collapsed border does not move
// with a sticky header (same as TableGrid).
export const inventoryTheadClass = 'sticky top-0 z-10 bg-cream';
export const inventoryHeadRowClass = 'h-10 bg-cream [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]';
export const inventoryThClass = TABLE_HEADER_CLASS;
export const inventoryTdClass = 'px-4 py-2.5 text-deep-violet-blue';
export const inventoryRowClass = 'border-b border-lavander/80 bg-white hover:bg-cream/50';

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
 * ui/DataTable): the title and row count, the month checkbox filter (cleared
 * from its own popover) and the shared page footer (ui/TablePagination), with
 * the table flush to the card's edges. `children` draws the columns for the
 * current page's rows, and places `monthHeader` on the Month column.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {object[]} props.rows rows before the month filter
 * @param {string} [props.description]
 * @param {boolean} [props.loading] first load in flight: the row count shows a
 *   placeholder, and `children` should draw InventoryTableSkeleton rows
 * @param {(visible: object[], monthHeader: import('react').ReactNode) => import('react').ReactNode} props.children
 *   `visible` is the current page's rows; it is empty only when nothing
 *   matches, so a "no rows" message still works
 */
export default function InventoryTableFrame({ title, rows, description, loading = false, children }) {
  const [monthFilter, setMonthFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  // The page belongs to the list it was picked on: when the rows or the month
  // filter change, the table starts again at page 1 (derived, no effect).
  const [paging, setPaging] = useState({ page: 1, listKey: '' });

  const monthOptions = monthCheckboxOptions(rows);
  const knownMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => knownMonths.has(value));
  const visible = activeMonthFilter.length
    ? rows.filter((row) => activeMonthFilter.includes(row.month.slice(0, 7)))
    : rows;

  const listKey = `${rows.length}|${activeMonthFilter.join(',')}`;
  const page = paging.listKey === listKey ? paging.page : 1;
  // paginate clamps the page, so a shorter list never lands on an empty one.
  const { pageRows, currentPage, totalPages } = paginate(visible, page, pageSize);

  function changePage(next) {
    setPaging({ page: next, listKey });
  }

  function changePageSize(size) {
    setPageSize(size);
    setPaging({ page: 1, listKey });
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
        onChange={setMonthFilter}
      />
    </th>
  );

  return (
    <section aria-label={title} className="flex flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm">
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
      </div>

      {/* One page at full height, so there is no inner scroll box and no long
          page; overflow-x stays for wide tables on small screens. */}
      <div className="overflow-x-auto border-t border-lavander">
        {children(pageRows, monthHeader)}
      </div>

      {!loading && visible.length > 0 && (
        <TablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={visible.length}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
        />
      )}
    </section>
  );
}
