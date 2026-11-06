'use client';

import { useState } from 'react';

import SelectDropdown from '@/components/ui/SelectDropdown';
import useSellInOutlook from '@/hooks/useSellInOutlook';
import useSellInPlan from '@/hooks/useSellInPlan';
import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import {
  filterLabelClass,
  InventoryChartSlot,
  InventoryFilterCard,
  InventorySection,
  skuScopeLabel,
  StatTag,
} from './InventoryChrome';
import SellInDetailTable from './SellInPlanTable';
import SellInOutlookChart from './SellInOutlookChart';
import SkuDropdown from './SkuDropdown';

const MONTH_OPTIONS = [3, 6, 12].map((n) => ({ value: String(n), label: `${n} months` }));

const FORECAST_SOURCE_LABEL = {
  current: 'Sell-out Forecast (Current)',
  initial: 'Initial Yearly Sell-out Forecast',
  mixed: 'Current + Initial',
};

/**
 * The latest actual month's sell-out against its forecast (backend
 * inventory_service._last_month_vs_forecast), as pills above the chart.
 *
 * Only SKUs with a forecast for the month are compared, so when some have none
 * the actual here is lower than the chart's, and the pills say how many.
 *
 * @param {{ comparison: { month: string, actual: number, forecast: number, forecast_source: string, difference: number, percent: number | null, skus_compared: number, skus_with_actuals: number } }} props
 */
function LastMonthVsForecast({ comparison }) {
  const sign = comparison.difference > 0 ? '+' : comparison.difference < 0 ? '−' : '';
  const percent = comparison.percent === null ? '' : ` (${sign}${Math.abs(comparison.percent).toFixed(1)}%)`;
  const direction = comparison.difference > 0 ? 'above' : comparison.difference < 0 ? 'below' : 'on';
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="status">
      <span className="text-[11px] font-medium text-deep-violet-blue">
        {formatMonth(comparison.month)} sell-out vs forecast
      </span>
      {comparison.skus_compared < comparison.skus_with_actuals ? (
        <StatTag
          label="SKUs"
          value={`${comparison.skus_compared} of ${comparison.skus_with_actuals} (the rest have no forecast)`}
        />
      ) : null}
      <StatTag label="Actual" value={`${formatUnits(comparison.actual)} units`} />
      <StatTag
        label="Forecast"
        value={`${formatUnits(comparison.forecast)} units · ${FORECAST_SOURCE_LABEL[comparison.forecast_source]}`}
      />
      <StatTag
        label="Difference"
        value={`${sign}${formatUnits(Math.abs(comparison.difference))} units${percent} ${direction} forecast`}
      />
    </div>
  );
}

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
  const outlook = useSellInOutlook({ customerId, months, skus, refreshKey });
  const customerName = customers.find((c) => c.customer_id === customerId)?.customer_name;
  const outlookTags = [
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : '—' },
    { label: 'SKU', value: skuScopeLabel(skus) },
  ];

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
        <div className="min-w-0">
          <span className={filterLabelClass}>Customer</span>
          {/* SelectDropdown values are strings; customer ids are numbers. */}
          <SelectDropdown
            value={customerId === null ? '' : String(customerId)}
            onChange={(value) => setCustomerId(Number(value))}
            options={customers.map((c) => ({ value: String(c.customer_id), label: retailerLabel(c.customer_name) }))}
            ariaLabel="Customer"
            look="compact"
          />
        </div>

        <SkuDropdown skuOptions={skuOptions} skus={skus} onChange={setSkus} />

        <div className="min-w-0">
          <span className={filterLabelClass}>Months ahead</span>
          <SelectDropdown
            value={String(months)}
            onChange={(value) => setMonths(Number(value))}
            options={MONTH_OPTIONS}
            ariaLabel="Months ahead"
            look="compact"
          />
        </div>
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

      <InventorySection title="Sell-in and sell-out" tags={outlookTags}>
        {outlook.data?.last_month_vs_forecast ? (
          <LastMonthVsForecast comparison={outlook.data.last_month_vs_forecast} />
        ) : null}
        <InventoryChartSlot loading={outlook.loading} ready={Boolean(outlook.data)}>
          {outlook.data && (
            <SellInOutlookChart months={outlook.data.months} actualsThrough={outlook.data.actuals_through} />
          )}
        </InventoryChartSlot>
      </InventorySection>

      {(data || loading) && <SellInDetailTable rows={data?.rows ?? []} loading={loading && !data} />}
    </div>
  );
}
