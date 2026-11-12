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
import TableRow from '@/components/ui/TableRow';
import { cn } from '@/lib/utils';

import { inventorySkuColumns } from './columns';
import InventoryTableFrame, {
  inventoryCellClass,
  inventoryNumberCellClass,
  inventoryRowHeightClass,
} from './InventoryTableFrame';

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
  const columns = inventorySkuColumns({ showCustomer, showDoh, editable: Boolean(onEdit) });

  return (
    <InventoryTableFrame
      title={title}
      rows={sorted}
      columns={columns}
      minWidth={showDoh ? '86rem' : '70rem'}
      loading={loading}
    >
      {(pageRows) => pageRows.map((row) => (
        <TableRow key={`${row.customer_id}-${row.sku}-${row.month}`} className={inventoryRowHeightClass}>
          {showCustomer && <td className={inventoryCellClass}>{customerLabel(row.customer_name)}</td>}
          <td className={cn(inventoryCellClass, 'font-medium')}>{formatMonth(row.month)}</td>
          <td className={cn(inventoryCellClass, 'font-mono')}>{row.sku}</td>
          <td className={cn(inventoryCellClass, 'truncate')} title={row.product_name}>{row.product_name}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.opening_stock)}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.sell_in)}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.sell_out)}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.building_blocks)}</td>
          <td className={cn(inventoryNumberCellClass, 'font-medium')}>{formatUnits(row.ending_stock)}</td>
          {showDoh && (
            <>
              <td className={inventoryNumberCellClass}>{formatDoh(row.doh)}</td>
              <td className={inventoryNumberCellClass}>{formatDoh(row.target_doh)}</td>
              <td className={inventoryNumberCellClass}>{formatGap(row.doh_vs_target)}</td>
              <td className={cn(inventoryCellClass, STATUS_CLASSES[row.doh_status])}>
                {DOH_STATUS_LABELS[row.doh_status] ?? '—'}
              </td>
            </>
          )}
          {onEdit && (
            <td className="px-2 py-1.5 text-right">
              {/* A month with no rows of its own (stock carried forward) has nothing to edit. */}
              {row.has_data && (
                <RowActions
                  label={`Actions for ${row.product_name} in ${formatMonth(row.month)}`}
                  actions={[{ key: 'edit', label: 'Edit inventory', icon: Pencil, onSelect: () => onEdit(row) }]}
                />
              )}
            </td>
          )}
        </TableRow>
      ))}
    </InventoryTableFrame>
  );
}
