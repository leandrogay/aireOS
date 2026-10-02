'use client';

import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

const thClass = 'sticky top-0 bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

/**
 * The plan per SKU and month, in the order it is worked out: the opening
 * inventory, the forecast sell-out, any temporary sell-in already sent, the
 * stock to hold at the end of the month for the target DOH, the recommended
 * sell-in, the days of holding left at month end and the projected ending
 * stock. The sell-in lands during the month it is shown against.
 *
 * @param {{ rows: object[] }} props
 */
export default function SellInDetailTable({ rows }) {
  if (rows.length === 0) return null;

  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>Month</th>
            <th className={thClass}>Product</th>
            <th className={cn(thClass, numClass)}>Opening inventory</th>
            <th className={cn(thClass, numClass)}>Forecast sell-out</th>
            <th className={cn(thClass, numClass)}>Temporary sell-in</th>
            <th className={cn(thClass, numClass)}>Stock needed</th>
            <th className={cn(thClass, numClass)}>Recommended sell-in</th>
            <th className={cn(thClass, numClass)}>DOH after sell-in</th>
            <th className={cn(thClass, numClass)}>Projected ending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.sku}-${row.month}`} className="border-t border-lavander">
              <td className={tdClass}>{formatMonth(row.month)}</td>
              <td className={tdClass}>{row.product_name}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.opening_stock)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.forecast_sell_out)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.shipped_so_far)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.stock_needed)}</td>
              <td className={cn(tdClass, numClass, 'font-medium')}>{formatUnits(row.recommended_sell_in)}</td>
              <td className={cn(tdClass, numClass)}>{formatDoh(row.doh_after_sell_in)}</td>
              <td className={cn(tdClass, numClass)}>{formatUnits(row.projected_ending_stock)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
