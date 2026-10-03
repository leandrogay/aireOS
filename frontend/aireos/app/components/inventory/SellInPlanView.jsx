'use client';

import { useState } from 'react';

import useSellInPlan from '@/hooks/useSellInPlan';
import { formatDoh, formatMonth } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import {
  filterControlClass,
  filterLabelClass,
  InventoryFilterCard,
  StatTag,
} from './InventoryChrome';
import SellInDetailTable from './SellInPlanTable';
import SkuDropdown from './SkuDropdown';

const MONTH_CHOICES = [3, 6, 12];

/**
 * Where the plan starts. Each SKU plans from its own last actual month, so when
 * they differ (actuals were entered for only some SKUs) the range is shown.
 *
 * @param {Record<string, string>} lastActualBySku 'YYYY-MM-DD' per SKU
 * @returns {string}
 */
function startsFromLabel(lastActualBySku) {
  const months = [...new Set(Object.values(lastActualBySku))].sort();
  if (months.length === 1) return formatMonth(months[0]);
  return `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`;
}

/**
 * How much to sell in to a customer over the coming months. Stock is projected
 * from the customer's last actual ending stock using the forecast sell-out, and
 * each month's sell-in is what holds the customer's target DOH at month end
 * (never below 0). See backend inventory_calc.build_sell_in_plan for the rule.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {number} props.refreshKey bumped after a create/edit
 */
export default function SellInPlanView({ customers, skuOptions, refreshKey }) {
  const [customerId, setCustomerId] = useState(null);
  const [months, setMonths] = useState(6);
  const [skus, setSkus] = useState([]);

  // Adjust state during render: pick the first customer once the list arrives,
  // so the view is never empty by default. Runs only while nothing is chosen.
  if (customerId === null && customers.length > 0) {
    setCustomerId(customers[0].customer_id);
  }

  const { data, loading, error } = useSellInPlan({ customerId, months, skus, refreshKey });

  function clearFilters() {
    setSkus([]);
    setMonths(6);
  }

  return (
    <div className="space-y-1">
      <InventoryFilterCard
        canClear={skus.length > 0 || months !== 6}
        onClear={clearFilters}
        stats={data?.actuals_through ? (
          <>
            <StatTag label="Starts" value={startsFromLabel(data.actuals_through_by_sku)} />
            <StatTag label="Target" value={`${formatDoh(data.threshold.target_doh)} days`} />
            {data.threshold.is_global_default ? <StatTag label="Source" value="Global default" /> : null}
          </>
        ) : null}
        note={data?.actuals_through_by_sku && new Set(Object.values(data.actuals_through_by_sku)).size > 1
          ? 'Each SKU starts from its own last actual month.'
          : null}
      >
        <label htmlFor="inventory-plan-customer">
          <span className={filterLabelClass}>Customer</span>
          <select
            id="inventory-plan-customer"
            value={customerId ?? ''}
            onChange={(e) => setCustomerId(Number(e.target.value))}
            className={filterControlClass}
          >
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {retailerLabel(c.customer_name)}
              </option>
            ))}
          </select>
        </label>

        <SkuDropdown skuOptions={skuOptions} skus={skus} onChange={setSkus} />

        <label htmlFor="inventory-months-ahead">
          <span className={filterLabelClass}>Months ahead</span>
          <select
            id="inventory-months-ahead"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className={filterControlClass}
          >
            {MONTH_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
      </InventoryFilterCard>

      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}

      {data && data.skus_without_forecast.length > 0 && (
        <div className="rounded-lg border border-lavander bg-white px-3 py-2.5 shadow-sm" role="status">
          <p className="text-xs text-deep-violet-blue">
            <span className="font-medium">
              {data.skus_without_forecast.length === 1
                ? '1 SKU has no forecast'
                : `${data.skus_without_forecast.length} SKUs have no forecast`}
            </span>
            <span className="text-deep-violet-blue/70">
              , so {data.skus_without_forecast.length === 1 ? 'it is' : 'they are'} not in this plan.
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {data.skus_without_forecast.map((sku) => (
              <span
                key={sku.sku}
                className="rounded-full border border-lavander bg-lavander/60 px-2 py-0.5 text-[11px] text-deep-violet-blue"
              >
                {sku.product_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {(data || loading) && <SellInDetailTable rows={data?.rows ?? []} loading={loading && !data} />}
    </div>
  );
}
