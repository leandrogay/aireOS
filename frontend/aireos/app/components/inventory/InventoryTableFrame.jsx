'use client';

import { useState } from 'react';

import HeaderCheckboxFilter from '@/components/forecast/HeaderCheckboxFilter';
import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { monthCheckboxOptions } from '@/app/utils/inventoryForm';

const actionButtonClass =
  'rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40';

export const inventoryThClass =
  'px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60';
export const inventoryTdClass = 'px-2.5 py-2 text-deep-violet-blue';
export const inventoryRowClass = 'border-b border-lavander/80 bg-white hover:bg-cream/50';

/**
 * Placeholder rows for an inventory table's first load, sized like the real
 * rows (inventoryRowClass / inventoryTdClass) so nothing moves when they arrive.
 *
 * @param {{ columns: number }} props
 */
export function InventoryTableSkeleton({ columns }) {
  return <TableSkeleton columns={columns} rows={5} className="h-8 bg-white" cellClassName="px-2.5 py-2" />;
}

/**
 * Forecast-style table shell shared by the inventory tabs: a count, Clear,
 * Expand/Collapse, and the month checkbox filter. `children` draws the columns
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
    <th className="px-1.5 py-2">
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
    <section className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-base text-deep-violet-blue">{title}</h3>
          {loading ? (
            <Skeleton aria-hidden="true" className="mt-1 h-3 w-24 rounded bg-lavander" />
          ) : (
            <p className="text-[11px] text-deep-violet-blue/70">
              {visible.length} of {rows.length} rows shown
            </p>
          )}
          {description ? (
            <p className="mt-1 max-w-3xl text-[11px] text-deep-violet-blue/60">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearMonthFilter}
            disabled={activeMonthFilter.length === 0}
            className={actionButtonClass}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className={actionButtonClass}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-lavander">
        <div className={expanded ? '' : 'max-h-[28vh] overflow-y-auto'}>
          {children(visible, monthHeader)}
        </div>
      </div>
    </section>
  );
}
