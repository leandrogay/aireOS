'use client';

import { useState } from 'react';

import useAtRisk from '@/hooks/useAtRisk';
import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import { filterControlClass, filterLabelClass, InventoryFilterCard, StatTag } from './InventoryChrome';
import InventoryTableFrame, {
  inventoryRowClass,
  inventoryTdClass,
  inventoryThClass,
} from './InventoryTableFrame';

const RISK_LABELS = { below_min: 'Low stock', above_max: 'Overstock' };
const RISK_CLASSES = { below_min: 'text-red-700', above_max: 'text-amber-700' };
const numClass = 'tabular-nums';

/**
 * One list of every SKU at risk across all customers: days of holding below the
 * customer's min (low stock) or above its max (overstock) in the latest month of
 * actuals, most severe first. Nothing is stored: the list is recalculated on
 * every load, so a SKU drops off it once new data brings it back inside its band.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number} props.refreshKey bumped after a create/edit
 */
export default function AtRiskView({ customers, refreshKey }) {
  const [customerId, setCustomerId] = useState('');
  const [risk, setRisk] = useState('');

  const { data, loading, error } = useAtRisk({
    customerIds: customerId ? [Number(customerId)] : [],
    risk,
    refreshKey,
  });

  function clearFilters() {
    setCustomerId('');
    setRisk('');
  }

  return (
    <div className="space-y-2">
      <InventoryFilterCard
        canClear={Boolean(customerId || risk)}
        onClear={clearFilters}
        stats={data?.as_of ? (
          <>
            <StatTag label="As of" value={formatMonth(data.as_of)} />
            <StatTag label="Low stock" value={String(data.counts.below_min)} />
            <StatTag label="Overstock" value={String(data.counts.above_max)} />
          </>
        ) : null}
      >
        <label htmlFor="inventory-risk-customer">
          <span className={filterLabelClass}>Customer</span>
          <select
            id="inventory-risk-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={filterControlClass}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {retailerLabel(c.customer_name)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="inventory-risk">
          <span className={filterLabelClass}>Risk</span>
          <select
            id="inventory-risk"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            className={filterControlClass}
          >
            <option value="">All at-risk SKUs</option>
            <option value="below_min">Low stock (below min)</option>
            <option value="above_max">Overstock (above max)</option>
          </select>
        </label>
      </InventoryFilterCard>

      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}

      {data && (
        <InventoryTableFrame
          title="At-risk SKUs"
          rows={data.items}
          description="A SKU is at risk when its days of holding is outside the customer's min-max band. It leaves this list automatically once its days of holding is back inside the band."
        >
          {(visible, monthHeader) => (
            <table className="w-full text-left text-xs text-deep-violet-blue">
              <thead className="sticky top-0 z-10 bg-cream">
                <tr className="border-b border-lavander">
                  <th className={inventoryThClass}>Customer</th>
                  {monthHeader}
                  <th className={inventoryThClass}>SKU</th>
                  <th className={inventoryThClass}>Product</th>
                  <th className={cn(inventoryThClass, numClass)}>Ending stock</th>
                  <th className={cn(inventoryThClass, numClass)}>DOH</th>
                  <th className={cn(inventoryThClass, numClass)}>Min</th>
                  <th className={cn(inventoryThClass, numClass)}>Max</th>
                  <th className={cn(inventoryThClass, numClass)}>Days outside band</th>
                  <th className={inventoryThClass}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={9}>
                      {data.items.length === 0 ? 'No SKUs are at risk.' : 'No rows match these filters.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((item) => (
                    <tr key={`${item.customer_id}-${item.sku}`} className={inventoryRowClass}>
                      <td className={inventoryTdClass}>{retailerLabel(item.customer_name)}</td>
                      <td className={cn(inventoryTdClass, 'font-medium')}>{formatMonth(item.month)}</td>
                      <td className={cn(inventoryTdClass, 'font-mono')}>{item.sku}</td>
                      <td className={inventoryTdClass}>{item.product_name}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatUnits(item.ending_stock)}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatDoh(item.doh)}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatDoh(item.min_doh)}</td>
                      <td className={cn(inventoryTdClass, numClass)}>{formatDoh(item.max_doh)}</td>
                      <td className={cn(inventoryTdClass, numClass, 'font-medium')}>{formatDoh(item.days_outside_band)}</td>
                      <td className={cn(inventoryTdClass, RISK_CLASSES[item.doh_status])}>{RISK_LABELS[item.doh_status]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </InventoryTableFrame>
      )}

      {loading && !data && (
        <p className="text-xs text-muted-foreground">Checking stock levels…</p>
      )}
    </div>
  );
}
