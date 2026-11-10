'use client';

import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
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
      loading={loading}
      listId={customerId ?? ''}
    >
      {(visible, monthHeader) => (
        // Fixed widths so the columns don't move between pages; Product takes
        // what's left of the min-width.
        <table className={cn(inventoryTableClass, 'table-fixed', 'min-w-[68rem]')}>
          <InventoryColGroup
            widths={[
              '7rem', // Month
              null, // Product
              '6.5rem', // Opening inventory
              '7.5rem', // Forecast sell-out (room for the Initial tag)
              '6.5rem', // Temporary sell-in
              '6rem', // Stock needed
              '7rem', // Recommended sell-in
              '6rem', // DOH after sell-in
              '6.5rem', // Projected ending
            ]}
          />
          <thead className={inventoryTheadClass}>
            <tr className={inventoryHeadRowClass}>
              {monthHeader}
              <th className={inventoryThClass}>Product</th>
              <th className={cn(inventoryThClass, numClass)}>Opening inventory</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('Forecast sell-out')}</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('Temporary sell-in')}</th>
              <th className={cn(inventoryThClass, numClass)}>Stock needed</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('Recommended sell-in')}</th>
              <th className={cn(inventoryThClass, numClass)}>{headingLabel('DOH after sell-in')}</th>
              <th className={cn(inventoryThClass, numClass)}>Projected ending</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {loading ? (
              <InventoryTableSkeleton columns={9} />
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={9}>
                  {rows.length === 0 ? 'No SKUs are in this plan.' : 'No rows match these filters.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={`${row.sku}-${row.month}`} className={inventoryRowClass}>
                  <td className={cn(inventoryTdClass, 'font-medium')}>{formatMonth(row.month)}</td>
                  <td className={inventoryTdClass}>{row.product_name}</td>
                  <td className={cn(inventoryTdClass, numClass)}>{formatUnits(row.opening_stock)}</td>
                  <td className={cn(inventoryTdClass, numClass)}>
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
