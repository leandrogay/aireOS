'use client';

import { useCallback, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import SkuRanking from "@/components/dashboard/SkuRanking";
import RevenueTrendCard from "@/components/dashboard/RevenueTrendCard";
import RevenueSummaryCards from "@/components/dashboard/RevenueSummaryCards";
import DashboardFilters from "@/components/dashboard/DashboardFilters";
import FilterBadge from "@/components/dashboard/FilterBadge";
import PeriodComparisonDetail from "@/components/dashboard/PeriodComparisonDetail";
import CustomerSelector from "@/components/dashboard/CustomerSelector";
import useDataFreshness from "@/hooks/useDataFreshness";
import useDashboardSummary from "@/hooks/useDashboardSummary";
import usePeriodComparison from "@/hooks/usePeriodComparison";
import useDefaultDateRange from "@/hooks/useDefaultDateRange";
import useCustomerOptions from "@/hooks/useCustomerOptions";
import { formatDateRange } from "@/lib/formatDateRange";

// Whole days between two ISO (YYYY-MM-DD) dates, parsed as local midnight so
// this isn't off-by-one across timezones.
function daySpan(start, end) {
  if (!start || !end) return 0;
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  return (endMs - startMs) / 86400000;
}

export default function DashboardPage() {
  const { channels, dataVersion, refreshing } = useDataFreshness();

  // Page-header customer (retailer family, e.g. "Fairprice") selector —
  // every other filter/query below is scoped underneath it. Distinct from
  // `store` (a single branch within that customer, e.g. a FairPrice outlet)
  // — see DashboardFilters. Starts unset and auto-selects the first
  // available customer once useCustomerOptions loads, the same
  // "adjust state during render" pattern usePeriodComparison uses for its
  // own external-change detection: this is a page-wide scope selector
  // everything else waits on, not an optional filter, so it should never
  // sit unset once at least one customer exists.
  const { options: customerOptions, loading: customerOptionsLoading, error: customerOptionsError } =
    useCustomerOptions({ dataVersion });
  const [customer, setCustomer] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  if (!customer && customerOptions.length > 0) {
    setCustomer(customerOptions[0].value);
    setCustomerLabel(customerOptions[0].label);
  }

  function handleCustomerChange(value, label) {
    setCustomer(value);
    setCustomerLabel(label);
  }

  const [sku, setSku] = useState('');
  const [skuLabel, setSkuLabel] = useState('');
  const [store, setStore] = useState('');
  const [storeLabel, setStoreLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState('offline');

  const handleDateRangeChange = useCallback((start, end) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const hasExplicitDateFilter = Boolean(startDate && endDate);
  const defaultMonthRange = useDefaultDateRange({ customer, mode, dataVersion, period: 'month' });
  const defaultWeekRange = useDefaultDateRange({ customer, mode, dataVersion, period: 'week' });
  const defaultSixMonthRange = useDefaultDateRange({ customer, mode, dataVersion, period: '6months' });
  const defaultYearRange = useDefaultDateRange({ customer, mode, dataVersion, period: '12months' });
  const effectiveStartDate = hasExplicitDateFilter ? startDate : defaultMonthRange.start;
  const effectiveEndDate = hasExplicitDateFilter ? endDate : defaultMonthRange.end;

  // Past 6 Months/Past Year span too many weeks to read as weekly bars, so
  // the chart switches to monthly bars for those (and for any custom range
  // of similar length) — matched by the named preset's own bounds first
  // (reliable regardless of exact day count), falling back to a day-span
  // check for arbitrary custom ranges. 60 days (~2 months) is the cutoff —
  // below that, weekly bars are still readable and more useful for spotting
  // trends; above it, too many weekly bars get cramped and monthly rollups
  // read better. Applied to BOTH the current and "previous" comparison
  // fetches (not just the main one) so the two sides of a side-by-side
  // comparison never end up on mismatched granularities.
  const isLongRangePreset =
    (Boolean(defaultSixMonthRange.start) &&
      effectiveStartDate === defaultSixMonthRange.start &&
      effectiveEndDate === defaultSixMonthRange.end) ||
    (Boolean(defaultYearRange.start) &&
      effectiveStartDate === defaultYearRange.start &&
      effectiveEndDate === defaultYearRange.end);
  const chartGranularity =
    isLongRangePreset || daySpan(effectiveStartDate, effectiveEndDate) > 60 ? 'month' : 'week';

  const summary = useDashboardSummary({
    dataVersion,
    sku,
    customer,
    store,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    granularity: chartGranularity,
  });
  // Fed the *effective* scope (not raw startDate/endDate) so a comparison,
  // once the user turns it on, always compares against whatever the
  // dashboard is actually showing right now — including the current-month
  // default — rather than a separate "latest week" fallback of its own.
  const comparison = usePeriodComparison({
    sku,
    mode,
    customer,
    store,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    onDateRangeChange: handleDateRangeChange,
    dataVersion,
  });
  // Only fetched while a comparison is actually active — feeds the chart's
  // side-by-side current-vs-previous view (see RevenueTrendCard).
  const previousSummary = useDashboardSummary({
    dataVersion,
    sku,
    customer,
    store,
    startDate: comparison.previousStart,
    endDate: comparison.previousEnd,
    granularity: chartGranularity,
    enabled: comparison.active && Boolean(comparison.previousStart && comparison.previousEnd),
  });
  const lastUpdated = customer ? channels[`${customer}_${mode}`] : null;

  function handleSkuChange(value, productName) {
    setSku(value);
    setSkuLabel(productName);
  }

  function clearSku() {
    setSku('');
    setSkuLabel('');
  }

  function handleStoreChange(value, storeName) {
    setStore(value);
    setStoreLabel(storeName);
  }

  function clearStore() {
    setStore('');
    setStoreLabel('');
  }

  function clearDateRange() {
    setStartDate('');
    setEndDate('');
  }

  function clearAllFilters() {
    clearSku();
    clearStore();
    clearDateRange();
    comparison.setComparisonType(null);
    comparison.setPreviousStart('');
    comparison.setPreviousEnd('');
  }

  const badges = [
    sku && <FilterBadge key="sku" label={`SKU: ${skuLabel || sku}`} onClear={clearSku} />,
    store && <FilterBadge key="store" label={`Store: ${storeLabel || store}`} onClear={clearStore} />,
    startDate && endDate && (
      <FilterBadge key="date" label={`Date: ${formatDateRange(startDate, endDate)}`} onClear={clearDateRange} />
    ),
  ].filter(Boolean);

  return (
    <AppShell>
      <main className="min-h-screen bg-cream px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h1 className="font-serif text-2xl text-deep-violet-blue">Sales Dashboard</h1>
            <CustomerSelector
              value={customer}
              onChange={handleCustomerChange}
              options={customerOptions}
              loading={customerOptionsLoading}
              error={customerOptionsError}
            />
          </div>

          <div className="grid grid-cols-1 gap-1 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueTrendCard
                summaryByMode={summary.summaryByMode}
                loading={summary.loading}
                refreshing={summary.refreshing}
                error={summary.error}
                freshnessRefreshing={refreshing}
                lastUpdated={lastUpdated}
                mode={mode}
                onModeChange={setMode}
                comparisonActive={comparison.active}
                previousSummaryByMode={previousSummary.summaryByMode}
                previousLoading={previousSummary.loading}
              />
            </div>
            <div>
              <DashboardFilters
                sku={sku}
                onSkuChange={handleSkuChange}
                customer={customer}
                store={store}
                onStoreChange={handleStoreChange}
                startDate={startDate}
                endDate={endDate}
                onDateRangeChange={handleDateRangeChange}
                effectiveStartDate={effectiveStartDate}
                effectiveEndDate={effectiveEndDate}
                defaultWeekRange={defaultWeekRange}
                defaultMonthRange={defaultMonthRange}
                defaultSixMonthRange={defaultSixMonthRange}
                defaultYearRange={defaultYearRange}
                comparisonType={comparison.comparisonType}
                onComparisonTypeChange={comparison.setComparisonType}
                dataVersion={dataVersion}
                activeFilters={badges.length > 0 && badges}
                onClearFilters={clearAllFilters}
              />
            </div>

            <div>
              <PeriodComparisonDetail
                result={comparison.result}
                loading={comparison.loading}
                error={comparison.error}
                active={comparison.active}
              />
            </div>
            <div className="lg:col-span-2">
              <RevenueSummaryCards
                summaryByMode={summary.summaryByMode}
                loading={summary.loading}
                error={summary.error}
                mode={mode}
              />
            </div>

            <div className="lg:col-span-3">
              <SkuRanking
                dataVersion={dataVersion}
                sku={sku}
                mode={mode}
                customer={customer}
                store={store}
                startDate={effectiveStartDate}
                endDate={effectiveEndDate}
              />
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
