'use client';

import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import TableRow from '@/components/ui/TableRow';
import { cn } from '@/lib/utils';

import { SELL_IN_PLAN_COLUMNS } from './columns';
import InventoryTableFrame, {
  inventoryCellClass,
  inventoryNumberCellClass,
  inventoryRowHeightClass,
} from './InventoryTableFrame';

/**
 * The plan per SKU and month, in the order it is worked out: the opening
 * inventory, the forecast sell-out, any temporary sell-in already sent, the
 * stock to hold at the end of the month for the target DOH, the recommended
 * sell-in, the days of holding left at month end and the projected ending
 * stock. The sell-in lands during the month it is shown against. A forecast
 * marked Initial is the Initial Yearly Forecast, used where the current
 * forecast does not reach the month yet.
 *
 * @param {{ rows: object[], loading?: boolean, customerId?: number | null }} props
 *   `loading`: first load in flight, so placeholder rows. `customerId`: the
 *   plan's customer, which its rows don't carry, so another customer's plan
 *   starts at page 1
 */
export default function SellInDetailTable({ rows, loading = false, customerId = null }) {
  return (
    <InventoryTableFrame
      title="Sell-in plan by SKU and month"
      rows={rows}
      columns={SELL_IN_PLAN_COLUMNS}
      minWidth="72rem"
      emptyMessage="No SKUs are in this plan."
      loading={loading}
      listId={customerId ?? ''}
    >
      {(pageRows) => pageRows.map((row) => (
        <TableRow key={`${row.sku}-${row.month}`} className={inventoryRowHeightClass}>
          <td className={cn(inventoryCellClass, 'font-medium')}>{formatMonth(row.month)}</td>
          <td className={cn(inventoryCellClass, 'truncate')} title={row.product_name}>{row.product_name}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.opening_stock)}</td>
          <td className={inventoryNumberCellClass}>
            {/* The current forecast does not reach this month yet (backend _plan_forecast). */}
            {row.forecast_source === 'initial' ? (
              <span
                className="mr-1 rounded-full border border-lavander bg-lavander/60 px-1.5 py-px text-[10px] text-deep-violet-blue/70"
                title="No current forecast for this month yet, so the Initial Yearly Sell-out Forecast is used."
              >
                Initial
              </span>
            ) : null}
            {formatUnits(row.forecast_sell_out)}
          </td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.shipped_so_far)}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.stock_needed)}</td>
          <td className={cn(inventoryNumberCellClass, 'font-medium')}>{formatUnits(row.recommended_sell_in)}</td>
          <td className={inventoryNumberCellClass}>{formatDoh(row.doh_after_sell_in)}</td>
          <td className={inventoryNumberCellClass}>{formatUnits(row.projected_ending_stock)}</td>
        </TableRow>
      ))}
    </InventoryTableFrame>
  );
}
