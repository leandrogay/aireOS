'use client';

import { Button } from '@/components/ui/button';
import {
  DOH_STATUS_LABELS,
  formatDoh,
  formatGap,
  formatMonth,
  formatUnits,
} from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

const thClass = 'sticky top-0 bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

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
 */
export default function InventorySkuTable({ rows, showDoh = false, showCustomer = true, onEdit }) {
  if (rows.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No rows match these filters.</p>;
  }

  const sorted = [...rows].sort(
    (a, b) => b.month.localeCompare(a.month) || a.product_name.localeCompare(b.product_name),
  );

  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {showCustomer && <th className={thClass}>Customer</th>}
            <th className={thClass}>Month</th>
            <th className={thClass}>SKU</th>
            <th className={thClass}>Product</th>
            <th className={cn(thClass, numClass)}>Opening</th>
            <th className={cn(thClass, numClass)}>Sell-in</th>
            <th className={cn(thClass, numClass)}>Sell-out</th>
            <th className={cn(thClass, numClass)}>Ending stock</th>
            {showDoh && (
              <>
                <th className={cn(thClass, numClass)}>DOH</th>
                <th className={cn(thClass, numClass)}>Target</th>
                <th className={cn(thClass, numClass)}>vs target</th>
                <th className={thClass}>Status</th>
              </>
            )}
            {onEdit && <th className={thClass} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.customer_id}-${row.sku}-${row.month}`} className="border-t border-lavander">
              {showCustomer && <td className={tdClass}>{row.customer_name}</td>}
              <td className={tdClass}>{formatMonth(row.month)}</td>
              <td className={cn(tdClass, 'font-mono text-xs')}>{row.sku}</td>
              <td className={tdClass}>{row.product_name}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.opening_stock)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.sell_in)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.sell_out)}</td>
              <td className={cn(tdClass, numClass, 'font-medium')}>{formatUnits(row.ending_stock)}</td>
              {showDoh && (
                <>
                  <td className={cn(tdClass, numClass)}>{formatDoh(row.doh)}</td>
                  <td className={cn(tdClass, numClass)}>{formatDoh(row.target_doh)}</td>
                  <td className={cn(tdClass, numClass)}>{formatGap(row.doh_vs_target)}</td>
                  <td className={cn(tdClass, STATUS_CLASSES[row.doh_status])}>
                    {DOH_STATUS_LABELS[row.doh_status] ?? '—'}
                  </td>
                </>
              )}
              {onEdit && (
                <td className={tdClass}>
                  {/* A month with no rows of its own (stock carried forward) has nothing to edit. */}
                  {row.has_data && (
                    <Button variant="outline" size="xs" onClick={() => onEdit(row)}>
                      Edit
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
