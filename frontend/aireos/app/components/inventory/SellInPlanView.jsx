'use client';

import { useState } from 'react';

import useSellInPlan from '@/hooks/useSellInPlan';
import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';

import SellInDetailTable from './SellInPlanTable';
import SellInPlanChart from './SellInPlanChart';
import { cardClass, inputClass, labelClass } from './formStyles';

const MONTH_CHOICES = [3, 6, 12];

/**
 * Where the plan starts. Each SKU plans from its own last actual month, so when
 * they differ (actuals were entered for only some SKUs) the range is shown.
 *
 * @param {Record<string, string>} lastActualBySku 'YYYY-MM-DD' per SKU
 * @returns {import('react').ReactNode}
 */
function startsFromText(lastActualBySku) {
  const months = [...new Set(Object.values(lastActualBySku))].sort();
  if (months.length === 1) {
    return (
      <>
        Starts from actual stock at the end of <strong>{formatMonth(months[0])}</strong>
      </>
    );
  }
  return (
    <>
      Each SKU starts from its own last actual month (<strong>{formatMonth(months[0])}</strong> to{' '}
      <strong>{formatMonth(months[months.length - 1])}</strong>)
    </>
  );
}

/**
 * How much to sell in to a customer over the coming months. Stock is projected
 * from the customer's last actual ending stock using the forecast sell-out, and
 * each month's sell-in is what holds the customer's target DOH at month end
 * (never below 0). See backend inventory_calc.build_sell_in_plan for the rule.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number} props.refreshKey bumped after a create/edit or threshold change
 */
export default function SellInPlanView({ customers, refreshKey }) {
  const [customerId, setCustomerId] = useState(null);
  const [months, setMonths] = useState(6);

  // Adjust state during render: pick the first customer once the list arrives,
  // so the view is never empty by default. Runs only while nothing is chosen.
  if (customerId === null && customers.length > 0) {
    setCustomerId(customers[0].customer_id);
  }

  const { data, loading, error } = useSellInPlan({ customerId, months, refreshKey });
  const grandTotal = data ? data.monthly_totals.reduce((sum, t) => sum + t.recommended_sell_in, 0) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="w-56">
          <span className={labelClass}>Customer</span>
          <select
            value={customerId ?? ''}
            onChange={(e) => setCustomerId(Number(e.target.value))}
            className={inputClass}
          >
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.customer_name}
              </option>
            ))}
          </select>
        </label>

        <label className="w-40">
          <span className={labelClass}>Months ahead</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={inputClass}>
            {MONTH_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>

        {data?.actuals_through && (
          <p className="pb-1.5 text-sm text-deep-violet-blue">
            {startsFromText(data.actuals_through_by_sku)}, holding{' '}
            <strong>{formatDoh(data.threshold.target_doh)}</strong> days of stock
            {data.threshold.is_global_default && (
              <span className="ml-2 rounded-full border border-violet bg-lavander px-2 py-0.5 text-[11px]">
                Global Default
              </span>
            )}
          </p>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}
      {loading && !data && <p className="text-sm text-deep-violet-blue/70">Building the plan…</p>}

      {data && (
        <div className="grid grid-cols-1 gap-2">
          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-medium text-deep-violet-blue">
              Recommended sell-in: {formatUnits(grandTotal)} units over {data.monthly_totals.length} months
            </h2>
            <p className="mb-2 text-xs text-deep-violet-blue/60">
              Tops each SKU up to the stock needed for the target DOH from the start of the month, counting that month
              and the next two, minus the stock on hand and anything already shipped. Sent stock mid-month? Record it
              under Enter / edit data, then Shipped so far.
            </p>
            <SellInPlanChart totals={data.monthly_totals} />
          </section>

          {data.skus_without_forecast.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No forecast for {data.skus_without_forecast.map((s) => s.product_name).join(', ')}, so{' '}
              {data.skus_without_forecast.length === 1 ? 'it is' : 'they are'} not in this plan.
            </p>
          )}

          <section className={cardClass}>
            <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Sell-in plan by SKU and month</h2>
            <SellInDetailTable rows={data.rows} />
          </section>
        </div>
      )}
    </div>
  );
}
