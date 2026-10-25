'use client';

import { useState } from 'react';

import HeaderCheckboxFilter from '@/components/forecast/HeaderCheckboxFilter';
import { Button } from '@/components/ui/button';
import { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { monthCheckboxOptions } from '@/app/utils/inventoryForm';
import { resultCountLabel } from '@/app/utils/tableView';
import { cn } from '@/lib/utils';

// The same look as the list tables on Customers, Promotions and SKUs
// (ui/DataTable + ui/TableGrid), so every table in the app reads alike.
const actionButtonClass = 'rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream';

export const inventoryTableClass = 'w-full text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle';
// White under the cream tint so rows do not show through the sticky header;
// the bottom rule is an inset shadow because a collapsed border does not move
// with a sticky header (same as TableGrid).
export const inventoryTheadClass = 'sticky top-0 z-10 bg-white';
export const inventoryHeadRowClass = 'h-10 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]';
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

  const monthOptions = monthCheckboxOptions(rows);
  const knownMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => knownMonths.has(value));
  const visible = activeMonthFilter.length
    ? rows.filter((row) => activeMonthFilter.includes(row.month.slice(0, 7)))
    : rows;

  function clearMonthFilter() {
    setMonthFilter([]);
    setOpenFilter(null);
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
        {children(visible, monthHeader)}
      </div>
    </section>
  );
}
