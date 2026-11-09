'use client';

import { useState } from 'react';

import BarChartSkeleton from '@/components/ui/BarChartSkeleton';
import useAtRisk from '@/hooks/useAtRisk';
import useInventoryOverview from '@/hooks/useInventoryOverview';
import { earliestMonthInput, filterMonthRange, latestMonthInput } from '@/app/utils/inventoryForm';

import EndingStockChart from './EndingStockChart';
import { InventoryChartSlot, InventorySection, monthRangeLabel, skuScopeLabel, StatTag } from './InventoryChrome';
import InventoryFilters from './InventoryFilters';
import InventorySkuTable from './InventorySkuTable';

/**
 * Overall inventory for every customer: ending stock per month as a bar per
 * customer, and the same data at SKU level below, with SKU and month filters.
 * Ending stock is derived by the backend (see inventory_calc.build_monthly_series).
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {number} props.refreshKey bumped after a create/edit to refetch
 * @param {(row: object) => void} props.onEditRow
 */
export default function InventoryOverview({ skuOptions, refreshKey, onEditRow }) {
  const [skus, setSkus] = useState([]);
  // null = the user has not touched the range, so it shows the full span of
  // the chart. Editing either picker (even to blank) makes the range theirs;
  // "Clear filters" returns it to null.
  const [startMonth, setStartMonth] = useState(null);
  const [endMonth, setEndMonth] = useState(null);
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const { data, loading, error } = useInventoryOverview({
    skus,
    atRiskOnly,
    refreshKey,
  });
  const { data: atRisk } = useAtRisk({ refreshKey });

  // The API returns the full history. From/To open on that whole span, which
  // is what the chart draws, and both the chart and the table follow the range.
  const rangeRows = data?.monthly?.length ? data.monthly : data?.skus ?? [];
  const defaultStart = earliestMonthInput(rangeRows);
  const defaultEnd = latestMonthInput(rangeRows);
  const shownStart = startMonth ?? defaultStart;
  const shownEnd = endMonth ?? defaultEnd;
  const tableRows = data ? filterMonthRange(data.skus, shownStart, shownEnd) : [];
  const chartRows = data ? filterMonthRange(data.monthly, shownStart, shownEnd) : undefined;
  // Customer x SKU pairs, the way the filtered overview counts them below.
  const atRiskCount = atRisk
    ? new Set(
      atRisk.items
        .filter((item) => !skus.length || skus.includes(item.sku))
        .map((item) => `${item.customer_id}-${item.sku}`),
    ).size
    : null;
  const atRiskSkuCount = data ? new Set(data.skus.map((row) => `${row.customer_id}-${row.sku}`)).size : 0;
  const distinctSkuCount = data ? new Set(data.skus.map((row) => row.sku)).size : 0;
  const customerCount = data ? new Set(data.skus.map((row) => row.customer_id)).size : 0;

  function clearFilters() {
    setSkus([]);
    setStartMonth(null);
    setEndMonth(null);
    setAtRiskOnly(false);
  }

  const scopeTags = [
    { label: 'SKU', value: skuScopeLabel(skus) },
    { label: 'Months', value: monthRangeLabel(shownStart, shownEnd) },
    // So the chart (or a screenshot of it) never looks like the full picture when it isn't.
    ...(atRiskOnly ? [{ label: 'Showing', value: 'At risk only' }] : []),
  ];
  const atRiskNote = !atRiskOnly || !data
    ? null
    : atRiskSkuCount === 0
      ? 'No SKUs are at risk right now.'
      : `Showing only the ${atRiskSkuCount} SKU${atRiskSkuCount === 1 ? '' : 's'} at risk. The chart and table both cover just these SKUs. See the At risk tab for the reasons.`;

  return (
    <div className="space-y-3">
      <InventoryFilters
        skuOptions={skuOptions}
        skus={skus}
        onSkusChange={setSkus}
        startMonth={shownStart}
        endMonth={shownEnd}
        defaultStart={defaultStart}
        defaultEnd={defaultEnd}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        atRiskOnly={atRiskOnly}
        onAtRiskChange={setAtRiskOnly}
        atRiskCount={atRiskCount}
        onClear={clearFilters}
        stats={data ? (
          <>
            <StatTag label="SKUs" value={String(distinctSkuCount)} />
            <StatTag label={customerCount === 1 ? 'Customer' : 'Customers'} value={String(customerCount)} />
          </>
        ) : null}
        note={atRiskNote}
      />

      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}

      <InventorySection title="Ending stock by month" tags={scopeTags}>
        <InventoryChartSlot
          loading={loading}
          ready={Boolean(data)}
          placeholder={(
            // Same frame and 308px height as EndingStockChart, so nothing moves when it arrives.
            // About the usual chart: ~20 months of history, a bar each for ~3 customers.
            <BarChartSkeleton
              bars={20}
              groups={3}
              height={308}
              legend
              label="Loading inventory…"
              className="rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2"
            />
          )}
        >
          {data && <EndingStockChart monthly={chartRows} allCustomers={data.customers} />}
        </InventoryChartSlot>
      </InventorySection>

      {(data || loading) && (
        <InventorySkuTable rows={tableRows} loading={loading && !data} onEdit={onEditRow} />
      )}
    </div>
  );
}
