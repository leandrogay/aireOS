'use client';

import { Pencil } from 'lucide-react';

import {
  DOH_STATUS_LABELS,
  formatDoh,
  formatGap,
  formatMonth,
  formatUnits,
} from '@/app/utils/inventoryForm';
import { customerLabel } from '@/app/utils/retailerLabel';
import RowActions from '@/components/ui/RowActions';
import { cn } from '@/lib/utils';

import InventoryTableFrame, {
  headingLabel,
  InventoryColGroup,
  inventoryHeadRowClass,
  inventoryTableClass,
  inventoryTheadClass,
  InventoryTableSkeleton,
  inventoryRowClass,
  inventoryTdClass,
  inventoryThClass,
} from './InventoryTableFrame';

const numClass = 'text-right tabular-nums';

const STATUS_CLASSES = {
  below_min: 'text-red-700',
  above_max: 'text-amber-700',
  within: 'text-emerald-700',
};

/**
 * SKU-level inventory rows (backend _stock_row; with `showDoh` also the DOH,
 * target, gap and status columns from get_customer_view). Newest month first.
 * `onEdit(row)` adds an action that opens the record form.
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
  const columnCount = 8 + (showCustomer ? 1 : 0) + (showDoh ? 4 : 0) + (onEdit ? 1 : 0);

  return (
    <InventoryTableFrame title={title} rows={sorted} loading={loading}>
      {(visible, monthHeader) => (
        // Fixed widths (InventoryColGroup) so the columns don't move between
        // pages; Product takes what's left of the min-width.
        <table className={cn(inventoryTableClass, 'table-fixed', showDoh ? 'min-w-[84rem]' : 'min-w-[68rem]')}>
          <InventoryColGroup
            widths={[
              showCustomer && '8rem',
              '7rem', // Month
              '6.5rem', // SKU
              null, // Product
              '5rem', // Opening
              '5rem', // Sell-in
              '5rem', // Sell-out
              '6rem', // Building blocks
              '5.5rem', // Ending stock
              showDoh && '4.5rem', // DOH
              showDoh && '5rem', // Target
              showDoh && '6rem', // vs target
              showDoh && '7rem', // Status
              Boolean(onEdit) && '4.5rem', // actions, as TableGrid's ACTIONS_COLUMN
            ]}
          />
          <thead className={inventoryTheadClass}>
            <tr className={inventoryHeadRowClass}>
              {showCustomer && <th className={inventoryThClass}>Customer</th>}
              {monthHeader}
              <th className={inventoryThClass}>SKU</th>
              <th className={inventoryThClass}>Product</th>
              <th className={cn(inventoryThClass, numClass)}>Opening</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('Sell-in')}</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('Sell-out')}</th>
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
              {onEdit && <th className={inventoryThClass}><span className="sr-only">Actions</span></th>}
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
                  {showCustomer && <td className={inventoryTdClass}>{customerLabel(row.customer_name)}</td>}
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
                    // py-1: the menu button is 32px, so the row stays the
                    // height of one without a menu and every page is as tall.
                    <td className={cn(inventoryTdClass, 'py-1 text-right')}>
                      {/* A month with no rows of its own (stock carried forward) has nothing to edit. */}
                      {row.has_data && (
                        <RowActions
                          label={`Actions for ${row.product_name} in ${formatMonth(row.month)}`}
                          actions={[{ key: 'edit', label: 'Edit inventory', icon: Pencil, onSelect: () => onEdit(row) }]}
                        />
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
