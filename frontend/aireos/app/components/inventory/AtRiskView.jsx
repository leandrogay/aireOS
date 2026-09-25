'use client';

import { useState } from 'react';

import useAtRisk from '@/hooks/useAtRisk';
import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import { cardClass, inputClass, labelClass } from './formStyles';

const RISK_LABELS = { below_min: 'Low stock', above_max: 'Overstock' };
const RISK_CLASSES = { below_min: 'text-red-700', above_max: 'text-amber-700' };

const thClass = 'sticky top-0 bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

/**
 * One list of every SKU at risk across all customers: days of holding below the
 * customer's min (low stock) or above its max (overstock) in the latest month of
 * actuals, most severe first. Nothing is stored: the list is recalculated on
 * every load, so a SKU drops off it once new data brings it back inside its band.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number} props.refreshKey bumped after a create/edit or threshold change
 */
export default function AtRiskView({ customers, refreshKey }) {
  const [customerId, setCustomerId] = useState('');
  const [risk, setRisk] = useState('');

  const { data, loading, error } = useAtRisk({
    customerIds: customerId ? [Number(customerId)] : [],
    risk,
    refreshKey,
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="w-56">
          <span className={labelClass}>Customer</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.customer_name}
              </option>
            ))}
          </select>
        </label>

        <label className="w-44">
          <span className={labelClass}>Risk</span>
          <select value={risk} onChange={(e) => setRisk(e.target.value)} className={inputClass}>
            <option value="">All at-risk SKUs</option>
            <option value="below_min">Low stock (below min)</option>
            <option value="above_max">Overstock (above max)</option>
          </select>
        </label>

        {data?.as_of && (
          <p className="pb-1.5 text-sm text-deep-violet-blue">
            Judged on <strong>{formatMonth(data.as_of)}</strong>: {data.counts.below_min} low stock,{' '}
            {data.counts.above_max} overstock
          </p>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}
      {loading && !data && <p className="text-sm text-deep-violet-blue/70">Checking stock levels…</p>}

      {data && (
        <section className={cardClass}>
          <h2 className="mb-1 text-sm font-medium text-deep-violet-blue">
            At-risk SKUs ({data.items.length})
          </h2>
          <p className="mb-2 text-xs text-deep-violet-blue/60">
            A SKU is at risk when its days of holding is outside the customer&apos;s min-max band. It leaves this list
            automatically once its days of holding is back inside the band.
          </p>
          {data.items.length === 0 ? (
            <p className="text-sm text-deep-violet-blue/70">No SKUs are at risk.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-lavander">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={thClass}>Customer</th>
                    <th className={thClass}>SKU</th>
                    <th className={thClass}>Product</th>
                    <th className={cn(thClass, numClass)}>Ending stock</th>
                    <th className={cn(thClass, numClass)}>DOH</th>
                    <th className={cn(thClass, numClass)}>Min</th>
                    <th className={cn(thClass, numClass)}>Max</th>
                    <th className={cn(thClass, numClass)}>Days outside band</th>
                    <th className={thClass}>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={`${item.customer_id}-${item.sku}`} className="border-t border-lavander">
                      <td className={tdClass}>{item.customer_name}</td>
                      <td className={cn(tdClass, 'font-mono text-xs')}>{item.sku}</td>
                      <td className={tdClass}>{item.product_name}</td>
                      <td className={cn(tdClass, numClass)}>{formatUnits(item.ending_stock)}</td>
                      <td className={cn(tdClass, numClass)}>{formatDoh(item.doh)}</td>
                      <td className={cn(tdClass, numClass)}>{formatDoh(item.min_doh)}</td>
                      <td className={cn(tdClass, numClass)}>{formatDoh(item.max_doh)}</td>
                      <td className={cn(tdClass, numClass, 'font-medium')}>{formatDoh(item.days_outside_band)}</td>
                      <td className={cn(tdClass, RISK_CLASSES[item.doh_status])}>{RISK_LABELS[item.doh_status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
