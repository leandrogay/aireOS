'use client';

import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import InventoryTableFrame, {
  InventoryTableSkeleton,
  inventoryRowClass,
  inventoryTdClass,
  inventoryThClass,
} from './InventoryTableFrame';

const numClass = 'tabular-nums';

/**
 * The plan per SKU and month, in the order it is worked out: the opening
 * inventory, the forecast sell-out, any temporary sell-in already sent, the
 * stock to hold at the end of the month for the target DOH, the recommended
 * sell-in, the days of holding left at month end and the projected ending
 * stock. The sell-in lands during the month it is shown against.
 *
 * @param {{ rows: object[], loading?: boolean }} props `loading`: first load in
 *   flight, so placeholder rows
 */
export default function SellInDetailTable({ rows, loading = false }) {
  return (
    <InventoryTableFrame title="Sell-in plan by SKU and month" rows={rows} loading={loading}>
      {(visible, monthHeader) => (
        <table className="w-full text-left text-xs text-deep-violet-blue">
          <thead className="sticky top-0 z-10 bg-cream">
            <tr className="border-b border-lavander">
              {monthHeader}
              <th className={inventoryThClass}>Product</th>
              <th className={cn(inventoryThClass, numClass)}>Opening inventory</th>
              <th className={cn(inventoryThClass, numClass)}>Forecast sell-out</th>
              <th className={cn(inventoryThClass, numClass)}>Temporary sell-in</th>
              <th className={cn(inventoryThClass, numClass)}>Stock needed</th>
              <th className={cn(inventoryThClass, numClass)}>Recommended sell-in</th>
              <th className={cn(inventoryThClass, numClass)}>DOH after sell-in</th>
              <th className={cn(inventoryThClass, numClass)}>Projected ending</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {loading ? (
              <InventoryTableSkeleton columns={9} />
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={8}>
                  {rows.length === 0 ? 'No SKUs are in this plan.' : 'No rows match these filters.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={`${row.sku}-${row.month}`} className={inventoryRowClass}>
                  <td className={cn(inventoryTdClass, 'font-medium')}>{formatMonth(row.month)}</td>
                  <td className={inventoryTdClass}>{row.product_name}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.opening_stock)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.forecast_sell_out)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.shipped_so_far)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.stock_needed)}</td>
                  <td className={cn(inventoryTdClass, numClass, 'font-medium')}>{formatUnits(row.recommended_sell_in)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatDoh(row.doh_after_sell_in)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.projected_ending_stock)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </InventoryTableFrame>
  );
}
