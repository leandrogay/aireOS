'use client';

import {
  DOH_STATUS_LABELS,
  formatDoh,
  formatGap,
  formatMonth,
  formatUnits,
} from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import InventoryTableFrame, {
  InventoryTableSkeleton,
  inventoryRowClass,
  inventoryTdClass,
  inventoryThClass,
} from './InventoryTableFrame';

const numClass = 'tabular-nums';

const STATUS_CLASSES = {
  below_min: 'text-red-700',
  above_max: 'text-amber-700',
  within: 'text-emerald-700',
};

/**
 * SKU-level inventory rows (backend _stock_row; with `showDoh` also the DOH,
 * target, gap and status columns from get_customer_view). Newest month first.
 * `onEdit(row)` adds an Edit button that hands the row to the record form.
 *
 * @param {object} props
 * @param {object[]} props.rows
 * @param {boolean} [props.showDoh]
 * @param {boolean} [props.showCustomer]
 * @param {(row: object) => void} [props.onEdit]
 * @param {string} [props.title]
 * @param {boolean} [props.loading] first load in flight: placeholder rows
 */
export default function InventorySkuTable({
  rows,
  showDoh = false,
  showCustomer = true,
  onEdit,
  title = 'Inventory by SKU',
  loading = false,
}) {
  const sorted = [...rows].sort(
    (a, b) => b.month.localeCompare(a.month) || a.product_name.localeCompare(b.product_name),
  );
  const columnCount = 6 + (showCustomer ? 1 : 0) + (showDoh ? 4 : 0) + (onEdit ? 1 : 0);

  return (
    <InventoryTableFrame title={title} rows={sorted} loading={loading}>
      {(visible, monthHeader) => (
        <table className="w-full text-left text-xs text-deep-violet-blue">
          <thead className="sticky top-0 z-10 bg-cream">
            <tr className="border-b border-lavander">
              {showCustomer && <th className={inventoryThClass}>Customer</th>}
              {monthHeader}
              <th className={inventoryThClass}>SKU</th>
              <th className={inventoryThClass}>Product</th>
              <th className={cn(inventoryThClass, numClass)}>Opening</th>
              <th className={cn(inventoryThClass, numClass)}>Sell-in</th>
              <th className={cn(inventoryThClass, numClass)}>Sell-out</th>
              <th className={cn(inventoryThClass, numClass)}>Building blocks</th>
              <th className={cn(inventoryThClass, numClass)}>Ending stock</th>
              {showDoh && (
                <>
                  <th className={cn(inventoryThClass, numClass)}>DOH</th>
                  <th className={cn(inventoryThClass, numClass)}>Target</th>
                  <th className={cn(inventoryThClass, numClass)}>vs target</th>
                  <th className={inventoryThClass}>Status</th>
                </>
              )}
              {onEdit && <th className={inventoryThClass}>Action</th>}
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {loading ? (
              <InventoryTableSkeleton columns={columnCount} />
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={columnCount}>
                  No rows match these filters.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={`${row.customer_id}-${row.sku}-${row.month}`}
                  className={inventoryRowClass}
                >
                  {showCustomer && <td className={inventoryTdClass}>{retailerLabel(row.customer_name)}</td>}
                  <td className={cn(inventoryTdClass, 'font-medium')}>{formatMonth(row.month)}</td>
                  <td className={cn(inventoryTdClass, 'font-mono')}>{row.sku}</td>
                  <td className={inventoryTdClass}>{row.product_name}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.opening_stock)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.sell_in)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.sell_out)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.building_blocks)}</td>
                  <td className={cn(inventoryTdClass, numClass, 'font-medium')}>{formatUnits(row.ending_stock)}</td>
                  {showDoh && (
                    <>
                      <td className={cn(inventoryTdClass, numClass)}>{formatDoh(row.doh)}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatDoh(row.target_doh)}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatGap(row.doh_vs_target)}</td>
                      <td className={cn(inventoryTdClass, STATUS_CLASSES[row.doh_status])}>
                        {DOH_STATUS_LABELS[row.doh_status] ?? '—'}
                      </td>
                    </>
                  )}
                  {onEdit && (
                    <td className={inventoryTdClass}>
                      {/* A month with no rows of its own (stock carried forward) has nothing to edit. */}
                      {row.has_data && (
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          className="rounded-md border border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[11px] font-medium text-deep-violet-blue transition hover:bg-cream"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </InventoryTableFrame>
  );
}
