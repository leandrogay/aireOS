'use client';

import { useEffect, useRef, useState } from 'react';

import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
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
export const inventoryRowClass = 'border-b border-lavander/80';

/**
 * Fixed column widths for an inventory table, as ui/TableGrid does: with
 * `table-fixed` on the table, the columns keep the same widths on every page
 * instead of resizing to each page's contents. A null width takes the space
 * left over (the Product column), so give the table a min-width at least the
 * sum of the others.
 *
 * @param {{ widths: Array<string | null | false> }} props one entry per column,
 *   in order; false leaves out a column that isn't shown
 */
export function InventoryColGroup({ widths }) {
  const shown = widths.filter((width) => width !== false);
  return (
    <colgroup>
      {shown.map((width, index) => (
        <col key={index} style={width ? { width } : undefined} />
      ))}
    </colgroup>
  );
}

/**
 * A column heading whose hyphens never break ("Forecast sell-out" wraps as
 * "Forecast / sell-out", never "Forecast sell- / out"): plain hyphens become
 * non-breaking ones (U+2011), which look the same.
 *
 * @param {string} label
 * @returns {string}
 */
export function headingLabel(label) {
  return label.replaceAll('-', '‑');
}

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
 * @param {string | number} [props.listId] what the rows belong to when they
 *   don't say (e.g. the customer), so switching it goes back to page 1
 * @param {boolean} [props.loading] first load in flight: the row count shows a
 *   placeholder, and `children` should draw InventoryTableSkeleton rows
 * @param {(visible: object[], monthHeader: import('react').ReactNode) => import('react').ReactNode} props.children
 *   `visible` is the current page's rows; it is empty only when nothing
 *   matches, so a "no rows" message still works
 */
export default function InventoryTableFrame({ title, rows, description, loading = false, listId = '', children }) {
  const [monthFilter, setMonthFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  // The page belongs to the list it was picked on (listKey below): when the
  // table is given a different list it starts again at page 1, derived during
  // render rather than reset in an effect.
  const [paging, setPaging] = useState({ page: 1, listKey: '' });

  const monthOptions = monthCheckboxOptions(rows);
  const knownMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => knownMonths.has(value));
  const visible = activeMonthFilter.length
    ? rows.filter((row) => activeMonthFilter.includes(row.month.slice(0, 7)))
    : rows;

  // Which rows the table holds, in order, not just how many: another customer
  // with the same number of rows, or a re-sort, is a different list. Values
  // aren't part of it, so a refresh after a save keeps the page. `listId`
  // names what the rows can't (the sell-in plan's rows carry no customer).
  const listKey = `${listId}|${rows.map((row) => `${row.customer_id ?? ''}-${row.sku ?? ''}-${row.month ?? ''}`).join(',')}`;
  const page = paging.listKey === listKey ? paging.page : 1;
  // paginate clamps the page, so a shorter list never lands on an empty one.
  const { pageRows, currentPage, totalPages } = paginate(visible, page, pageSize);

  // The table keeps the height of the tallest full page it has shown for this
  // list and page size, so a short last page leaves empty space instead of
  // the card shrinking and the footer's arrows jumping away from the cursor.
  const boxRef = useRef(null);
  const [tallest, setTallest] = useState({ key: '', height: 0 });
  const heightKey = `${listKey}|${activeMonthFilter.join(',')}|${pageSize}`;
  const fullPage = pageRows.length === pageSize;
  const minHeight = totalPages > 1 && tallest.key === heightKey ? tallest.height : undefined;

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !fullPage) return undefined;
    const observer = new ResizeObserver(() => {
      // A hidden tab measures 0; keep what was measured while it showed.
      const height = box.offsetHeight;
      if (!height) return;
      setTallest((current) => (
        current.key === heightKey && current.height >= height ? current : { key: heightKey, height }
      ));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [fullPage, heightKey]);

  function changePage(next) {
    setPaging({ page: next, listKey });
  }

  // Any change to the month filter, including clearing it, starts again at
  // page 1. Set here, not derived: clearing recreates the earlier list
  // exactly, which would otherwise bring back the page picked on it.
  function changeMonthFilter(next) {
    setMonthFilter(next);
    setPaging({ page: 1, listKey });
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
        onChange={changeMonthFilter}
      />
    </th>
  );

  return (
    <TableCard
      label={title}
      header={(
        <TableCardHeader
          title={title}
          detail={loading
            ? <Skeleton aria-label="Loading rows" className="h-3 w-20 rounded bg-lavander" />
            : <>{resultCountLabel(visible.length, rows.length, 'row')}{description ? ` · ${description}` : ''}</>}
        />
      )}
    >

      {/* One page at full height, so there is no inner scroll box and no long
          page; overflow-x stays for wide tables on small screens. */}
      <div ref={boxRef} className="overflow-x-auto border-t border-lavander" style={{ minHeight }}>
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
    </TableCard>
  );
}
