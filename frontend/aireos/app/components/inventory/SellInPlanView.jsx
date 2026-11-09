'use client';

import { useState } from 'react';

import BarChartSkeleton from '@/components/ui/BarChartSkeleton';
import LineChartSkeleton from '@/components/ui/LineChartSkeleton';
import SelectDropdown from '@/components/ui/SelectDropdown';
import useSavedBuildingBlocks from '@/hooks/useSavedBuildingBlocks';
import useSellInOutlook from '@/hooks/useSellInOutlook';
import useSellInPlan from '@/hooks/useSellInPlan';
import { blocksWithoutEffect, customerBlocks, pickedBlockIds } from '@/app/utils/buildingBlocksOverlay';
import { formatDoh, formatMonth } from '@/app/utils/inventoryForm';
import { customerLabel } from '@/app/utils/retailerLabel';

import BuildingBlocksOverlay from './BuildingBlocksOverlay';
import {
  filterLabelClass,
  InventoryChartSlot,
  InventoryFilterCard,
  InventorySection,
  monthRangeLabel,
  skuScopeLabel,
  StatTag,
} from './InventoryChrome';
import SellInDetailTable from './SellInPlanTable';
import SellInOutlookChart from './SellInOutlookChart';
import SkuDropdown from './SkuDropdown';

const MONTH_OPTIONS = [3, 6, 12].map((n) => ({ value: String(n), label: `${n} months` }));

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
  // The chart's "Start from" year; null = the backend's default, the current
  // year (get_sell_in_outlook). Reset when the customer or SKUs change, since
  // the years on offer depend on their actuals.
  const [startYear, setStartYear] = useState(null);
  // The chart's building blocks overlay: saved Scenario builder blocks,
  // picked by hand, drawn as extra lines (BuildingBlocksOverlay).
  const [overlayOn, setOverlayOn] = useState(false);
  const [blockIds, setBlockIds] = useState([]);

  // Adjust state during render: pick the first customer once the list arrives,
  // so the view is never empty by default. Runs only while nothing is chosen.
  if (customerId === null && customers.length > 0) {
    setCustomerId(customers[0].customer_id);
  }

  const customerName = customers.find((c) => c.customer_id === customerId)?.customer_name;
  const savedBlocks = useSavedBuildingBlocks({ enabled: overlayOn });
  const offeredBlocks = customerBlocks(savedBlocks.blocks, customerName);
  const appliedBlockIds = overlayOn ? pickedBlockIds(blockIds, offeredBlocks) : [];

  const { data, loading, error } = useSellInPlan({ customerId, months, skus, refreshKey });
  const outlook = useSellInOutlook({ customerId, months, skus, startYear, blockIds: appliedBlockIds, refreshKey });
  const chartMonths = outlook.data?.months ?? [];
  const outlookTags = [
    { label: 'Customer', value: customerName ? customerLabel(customerName) : '—' },
    { label: 'SKU', value: skuScopeLabel(skus) },
    ...(chartMonths.length
      ? [{ label: 'Months', value: monthRangeLabel(chartMonths[0].month, chartMonths[chartMonths.length - 1].month) }]
      : []),
  ];
  const startYearOptions = (outlook.data?.start_years ?? []).map((year) => ({ value: String(year), label: String(year) }));
  const shownStartYear = startYear ?? outlook.data?.start_year ?? null;

  function changeCustomer(id) {
    setCustomerId(id);
    setStartYear(null);
    setBlockIds([]);
  }

  function changeSkus(next) {
    setSkus(next);
    setStartYear(null);
  }

  function clearFilters() {
    setSkus([]);
    setMonths(6);
    setStartYear(null);
  }

  return (
    <div className="space-y-3">
      <InventoryFilterCard
        canClear={skus.length > 0 || months !== 6 || startYear !== null}
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
            onChange={(value) => changeCustomer(Number(value))}
            options={customers.map((c) => ({ value: String(c.customer_id), label: customerLabel(c.customer_name) }))}
            ariaLabel="Customer"
            look="compact"
          />
        </div>

        <SkuDropdown skuOptions={skuOptions} skus={skus} onChange={changeSkus} />

        <div className="min-w-0">
          <span className={filterLabelClass}>Start from</span>
          <SelectDropdown
            value={shownStartYear === null ? '' : String(shownStartYear)}
            onChange={(value) => setStartYear(Number(value))}
            options={startYearOptions}
            ariaLabel="Start from"
            look="compact"
            disabled={startYearOptions.length === 0}
          />
        </div>

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
        <div className="space-y-2">
          <BuildingBlocksOverlay
            enabled={overlayOn}
            onEnabledChange={setOverlayOn}
            blocks={offeredBlocks}
            blockIds={appliedBlockIds}
            onBlockIdsChange={setBlockIds}
            customerLabel={customerName ? customerLabel(customerName) : 'this customer'}
            loading={savedBlocks.loading}
            error={savedBlocks.error}
            withoutEffect={appliedBlockIds.length ? blocksWithoutEffect(outlook.data?.building_blocks ?? []) : []}
          />
          <InventoryChartSlot
            loading={outlook.loading}
            ready={Boolean(outlook.data)}
            placeholder={(
              // Same frame and 360px height as SellInOutlookChart: the year so far + the default 6 ahead.
              <LineChartSkeleton
                points={18}
                lines={4}
                height={360}
                legend
                legendItems={4}
                label="Loading inventory…"
                className="rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2"
              />
            )}
          >
            {outlook.data && (
              <SellInOutlookChart
                months={outlook.data.months}
                actualsThrough={outlook.data.actuals_through}
                sellInComparison={outlook.data.last_month_sell_in_vs_forecast}
                sellOutComparison={outlook.data.last_month_vs_forecast}
                showBlocks={appliedBlockIds.length > 0}
              />
            )}
          </InventoryChartSlot>
        </div>
      </InventorySection>

      {(data || loading) && <SellInDetailTable rows={data?.rows ?? []} loading={loading && !data} />}
    </div>
  );
}
