'use client';

import { useEffect, useRef, useState } from 'react';

import { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import { Skeleton } from '@/components/ui/skeleton';
import TableGrid from '@/components/ui/TableGrid';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import { monthCheckboxOptions } from '@/app/utils/inventoryForm';
import { paginate, resultCountLabel } from '@/app/utils/tableView';

// For the inventory tables that are not list tables and so stay hand-rolled
// (the InventoryQuantityTable form, SellInUploadForm's "Not saved" lines):
// the same look as ui/TableGrid. List tables go through InventoryTableFrame.
export const inventoryTableClass = 'aire-table-rows w-full text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle';
// Solid cream keeps rows from showing through the sticky header;
// the bottom rule is an inset shadow because a collapsed border does not move
// with a sticky header (same as TableGrid).
export const inventoryTheadClass = 'sticky top-0 z-10 bg-cream';
export const inventoryHeadRowClass = 'h-10 bg-cream [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]';
export const inventoryThClass = TABLE_HEADER_CLASS;
export const inventoryTdClass = 'px-4 py-2.5 text-deep-violet-blue';
export const inventoryRowClass = 'border-b border-lavander/80';

// The rows of a frame's table: TableRows, so they animate like every list
// table's (ui/TableGrid).
export const inventoryRowHeightClass = 'h-12 border-b border-lavander/80';
export const inventoryCellClass = 'px-4 py-2.5';
export const inventoryNumberCellClass = 'px-4 py-2.5 text-right tabular-nums';

/**
 * Table shell shared by the inventory tabs, in the list-table look (see
 * ui/DataTable): the title and row count, a ui/TableGrid whose `month` column
 * header filters the rows by month (a HeaderCheckboxFilter, through the
 * column's `filter`), and the shared page footer (ui/TablePagination), with
 * the table flush to the card's edges.
 *
 *   <InventoryTableFrame title="At-risk SKUs" rows={items} columns={AT_RISK_COLUMNS} minWidth="66rem">
 *     {(pageRows) => pageRows.map((item) => <TableRow key={…}>…</TableRow>)}
 *   </InventoryTableFrame>
 *
 * @param {object} props
 * @param {string} props.title
 * @param {object[]} props.rows rows before the month filter
 * @param {object[]} props.columns TableGrid columns (inventory/columns.js); the
 *   one keyed `month` gets the Month filter
 * @param {string} [props.minWidth] the table's min-width, at least the sum of
 *   the fixed column widths
 * @param {string} [props.description]
 * @param {string} [props.emptyMessage] shown when there are no rows at all
 *   (rows that only the Month filter hides say so instead)
 * @param {string | number} [props.listId] what the rows belong to when they
 *   don't say (e.g. the customer), so switching it goes back to page 1
 * @param {boolean} [props.loading] first load in flight: placeholder rows, and
 *   the row count shows a placeholder
 * @param {(pageRows: object[]) => import('react').ReactNode} props.children
 *   the current page's rows, as TableRows
 */
export default function InventoryTableFrame({
  title,
  rows,
  columns,
  minWidth,
  description,
  emptyMessage = 'No rows match these filters.',
  loading = false,
  listId = '',
  children,
}) {
  const [monthFilter, setMonthFilter] = useState([]);
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

  const gridColumns = columns.map((column) => (
    column.key === 'month'
      ? { ...column, filter: { selected: activeMonthFilter, options: monthOptions, onChange: changeMonthFilter } }
      : column
  ));
  const emptyState = !loading && visible.length === 0
    ? (rows.length === 0 ? emptyMessage : 'No rows match these filters.')
    : null;

  return (
    <TableCard
      variant="glass"
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
          page; TableGrid still scrolls sideways for a wide table on a small
          screen. */}
      <div ref={boxRef} style={{ minHeight }}>
        <TableGrid
          columns={gridColumns}
          minWidth={minWidth}
          isLoading={loading}
          skeletonRows={5}
          emptyState={emptyState}
          pageKey={currentPage}
        >
          {!loading && children(pageRows)}
        </TableGrid>
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
