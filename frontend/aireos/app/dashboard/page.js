'use client';

import { useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import SkuRanking from "@/components/dashboard/SkuRanking";
import RevenueTrendCard from "@/components/dashboard/RevenueTrendCard";
import RevenueSummaryCards from "@/components/dashboard/RevenueSummaryCards";
import DashboardFilters from "@/components/dashboard/DashboardFilters";
import FilterBadge from "@/components/dashboard/FilterBadge";
import PeriodComparisonDetail from "@/components/dashboard/PeriodComparisonDetail";
import CustomerSelector from "@/components/dashboard/CustomerSelector";
import PeriodControls from "@/components/dashboard/PeriodControls";
import useDataFreshness from "@/hooks/useDataFreshness";
import useDashboardSummary from "@/hooks/useDashboardSummary";
import useDefaultDateRange from "@/hooks/useDefaultDateRange";
import useCustomerOptions from "@/hooks/useCustomerOptions";
import useMonthlyOnly from "@/hooks/useMonthlyOnly";
import usePriceMix from "@/hooks/usePriceMix";
import {
  DEFAULT_COMPARE,
  alignComparisonBuckets,
  comparisonSetup,
  daysBetween,
  loadedWeeksInRange,
  sumPeriodTotals,
} from "@/app/utils/periodComparison";
import { DEFAULT_PRESET_ID, buildDateRangePresets } from "@/app/utils/dateRangePresets";
import { weeklyGapMessage } from "@/app/utils/weeklyGaps";

export default function DashboardPage() {
  const { channels, dataVersion, refreshing } = useDataFreshness();

  // Customer (retailer family, e.g. "Fairprice") selector — the top field
  // of the Filter panel; every other filter/query below is scoped underneath it. Distinct from
  // `store` (a single branch within that customer, e.g. a FairPrice outlet)
  // — see DashboardFilters. Starts unset and auto-selects the first
  // available customer once useCustomerOptions loads, via the "adjust
  // state during render" pattern: this is a
  // page-wide scope selector everything else waits on, not an optional
  // filter, so it should never sit unset once at least one customer exists.
  const { options: customerOptions, loading: customerOptionsLoading, error: customerOptionsError } =
    useCustomerOptions({ dataVersion });
  const [customer, setCustomer] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  if (!customer && customerOptions.length > 0) {
    setCustomer(customerOptions[0].value);
    setCustomerLabel(customerOptions[0].label);
  }

  // SKU codes and store codes belong to one customer's catalogue, so a
  // customer switch drops both rather than querying a combination that
  // can't exist. Period/compare stay, since dates mean the same for everyone.
  function handleCustomerChange(value, label) {
    setCustomer(value);
    setCustomerLabel(label);
    clearSku();
    clearStore();
  }

  const [sku, setSku] = useState('');
  const [skuLabel, setSkuLabel] = useState('');
  const [store, setStore] = useState('');
  const [storeLabel, setStoreLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState('offline');
  // "Compare to" baseline — none by default (DEFAULT_COMPARE); Clear Filters
  // returns to that. `customCompare` is only used while compareTo is
  // 'custom'.
  const [compareTo, setCompareTo] = useState(DEFAULT_COMPARE);
  const [customCompare, setCustomCompare] = useState({ start: '', end: '' });
  // null = pick automatically from the range length (see autoGranularity).
  const [granularityChoice, setGranularityChoice] = useState(null);

  function handleDateRangeChange(start, end) {
    setStartDate(start);
    setEndDate(end);
    setGranularityChoice(null);
  }

  function handleCompareChange(value, customRange) {
    setCompareTo(value);
    if (customRange) setCustomCompare(customRange);
  }

  // Every preset (and the MTD default) is anchored to the latest loaded
  // PREFERRED period for this channel — see dateRangePresets.js. "start" is
  // still a week's start in the common case, but can be a whole month's
  // start when that's the latest granularity actually loaded (periodType
  // 'month') — e.g. August 2026, which has no real weekly rows at all.
  // latestDataEnd is the real last day loaded either way; comparisonRange
  // and the Period/calendar controls use it instead of assuming +6 days.
  const { start: latestWeekStart, end: latestDataEnd } =
    useDefaultDateRange({ customer, mode, dataVersion, period: 'week' });
  const presets = buildDateRangePresets(latestWeekStart);
  const defaultRange = presets.find((preset) => preset.id === DEFAULT_PRESET_ID) ?? { start: '', end: '' };

  const hasExplicitDateFilter = Boolean(startDate && endDate);
  const effectiveStartDate = hasExplicitDateFilter ? startDate : defaultRange.start;
  const effectiveEndDate = hasExplicitDateFilter ? endDate : defaultRange.end;

  const rangeInputs = {
    start: effectiveStartDate,
    end: effectiveEndDate,
    latestWeekStart,
    latestDataEnd,
    custom: customCompare,
  };
  const { options: compareOptions, baseline, periodNames } = comparisonSetup(compareTo, rangeInputs);
  const compareShort = baseline ? `vs ${periodNames.baseline}` : '';

  // Some months are loaded only as monthly totals (e.g. August 2026), and a
  // weekly summary leaves them out. Checked for both sides of a comparison
  // before picking the granularity, so either side being month-only puts
  // both on month bars instead of leaving one side empty.
  const currentMonthlyOnly = useMonthlyOnly({
    dataVersion,
    customer,
    store,
    sku,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
  });
  const baselineMonthlyOnly = useMonthlyOnly({
    dataVersion,
    customer,
    store,
    sku,
    startDate: baseline?.start ?? '',
    endDate: baseline?.end ?? '',
    enabled: Boolean(baseline),
  });
  // Both sides' monthly-only months in one list: either way, they're the
  // months whose weekly sell-out is missing.
  const monthlyOnlyMonths = [
    ...(currentMonthlyOnly.data?.[mode] ?? []),
    ...(baseline ? (baselineMonthlyOnly.data?.[mode] ?? []) : []),
  ];
  const hasMonthlyOnly = monthlyOnlyMonths.length > 0;
  // Summaries wait for the check so they aren't fetched by week first and
  // then again by month.
  const granularityPending = currentMonthlyOnly.loading || baselineMonthlyOnly.loading;

  // Ranges longer than about a quarter (Past 12 months, YTD later in the
  // year) have too many weeks to read as weekly bars, so they default to
  // monthly bars, as do ranges with monthly-only data; the chart's
  // By week / By month switch overrides this until the range changes again.
  const rangeDays = effectiveStartDate && effectiveEndDate ? daysBetween(effectiveStartDate, effectiveEndDate) : 0;
  const autoGranularity = rangeDays > 100 || hasMonthlyOnly ? 'month' : 'week';
  const chartGranularity = granularityChoice ?? autoGranularity;
  // The user picked By week over monthly-only data — the weekly chart is
  // missing those months. Name exactly which ones (not the whole period), so
  // users know what weekly data to upload; never fabricate weekly bars.
  const weeklyGap = chartGranularity === 'week' ? weeklyGapMessage(monthlyOnlyMonths) : null;
  // The baseline is normally read by week so it can be paired week for week
  // (see alignComparisonBuckets); with monthly-only data on either side the
  // month view reads it by month too, where those months exist.
  const baselineGranularity = chartGranularity === 'month' && hasMonthlyOnly ? 'month' : 'week';

  const summary = useDashboardSummary({
    dataVersion,
    sku,
    customer,
    store,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    granularity: chartGranularity,
    enabled: !granularityPending,
  });
  // Same filters over the baseline's dates, so both sides of every
  // comparison (chart, cards, panel) are built the same way.
  const baselineSummary = useDashboardSummary({
    dataVersion,
    sku,
    customer,
    store,
    startDate: baseline?.start ?? '',
    endDate: baseline?.end ?? '',
    // Weekly unless monthly-only data needs month rows (baselineGranularity):
    // the chart pairs baseline week N with this period's week N and rolls
    // them into this period's buckets, so a month view compares exactly
    // matching weeks (see alignComparisonBuckets).
    granularity: baselineGranularity,
    enabled: Boolean(baseline) && !granularityPending,
  });

  const { priceMix } = usePriceMix({
    dataVersion,
    customer,
    mode,
    store,
    sku,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    baseline,
  });

  const currentTotals = summary.summaryByMode[mode]?.periodTotal ?? [];
  const baselineTotals = baseline ? (baselineSummary.summaryByMode[mode]?.periodTotal ?? []) : [];
  const comparisonRows = baseline
    ? alignComparisonBuckets(currentTotals, baselineTotals, {
        compareTo,
        granularity: chartGranularity,
        baselineGranularity,
        currentStart: effectiveStartDate,
        currentEnd: effectiveEndDate,
        baselineStart: baseline.start,
        latestWeekStart,
        currentByFormat: summary.summaryByMode[mode]?.periodByFormat ?? [],
        baselineWeeksByFormat: baselineSummary.summaryByMode[mode]?.periodByFormat ?? [],
      })
    : null;
  const currentWeeks = loadedWeeksInRange(effectiveStartDate, effectiveEndDate, latestWeekStart);
  const baselineWeeks = baseline ? loadedWeeksInRange(baseline.start, baseline.end, latestWeekStart) : null;

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

  function clearAllFilters() {
    clearSku();
    clearStore();
    handleDateRangeChange('', '');
    setCompareTo(DEFAULT_COMPARE);
    setCustomCompare({ start: '', end: '' });
  }

  const badges = [
    sku && <FilterBadge key="sku" label={`SKU: ${skuLabel || sku}`} onClear={clearSku} />,
    store && <FilterBadge key="store" label={`Store: ${storeLabel || store}`} onClear={clearStore} />,
  ].filter(Boolean);

  return (
    <PageLayout title="Sales Dashboard">
      <div className="grid grid-cols-1 gap-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueTrendCard
            summaryByMode={summary.summaryByMode}
            loading={summary.loading}
            refreshing={summary.refreshing}
            error={summary.error || (baseline ? baselineSummary.error : null)}
            freshnessRefreshing={refreshing}
            lastUpdated={lastUpdated}
            weeklyGap={weeklyGap}
            mode={mode}
            onModeChange={setMode}
            granularity={chartGranularity}
            onGranularityChange={setGranularityChoice}
            comparisonRows={comparisonRows}
            periodNames={periodNames}
            comparisonLoading={baselineSummary.loading}
            headerExtra={
              <PeriodControls
                start={effectiveStartDate}
                end={effectiveEndDate}
                presets={presets}
                latestWeekStart={latestWeekStart}
                latestDataEnd={latestDataEnd}
                onDateRangeChange={handleDateRangeChange}
                compareTo={compareTo}
                compareOptions={compareOptions}
                onCompareChange={handleCompareChange}
              />
            }
          />
        </div>

        {/* Right column: scope (Filters) then the headline change (Comparison),
            stacked beside the chart they explain. A grid rather than flex so
            the Comparison card's h-full fills whatever height the chart row
            leaves under the Filters. */}
        <div className="grid grid-rows-[auto_1fr] gap-1">
          <div>
            <DashboardFilters
              customerControl={
                <CustomerSelector
                  value={customer}
                  onChange={handleCustomerChange}
                  options={customerOptions}
                  loading={customerOptionsLoading}
                  error={customerOptionsError}
                />
              }
              sku={sku}
              onSkuChange={handleSkuChange}
              customer={customer}
              store={store}
              onStoreChange={handleStoreChange}
              hasPeriodChanges={hasExplicitDateFilter || compareTo !== DEFAULT_COMPARE}
              dataVersion={dataVersion}
              activeFilters={badges.length > 0 && badges}
              onClearFilters={clearAllFilters}
            />
          </div>
          <div>
            <PeriodComparisonDetail
              active={Boolean(baseline)}
              periodNames={periodNames}
              baseline={baseline}
              currentTotals={sumPeriodTotals(currentTotals)}
              baselineTotals={sumPeriodTotals(baselineTotals)}
              currentAvailable={currentTotals.length > 0}
              baselineAvailable={baselineTotals.length > 0}
              weekCounts={currentWeeks && baselineWeeks ? { current: currentWeeks.count, baseline: baselineWeeks.count } : null}
              priceMix={priceMix}
              loading={summary.loading || baselineSummary.loading}
              error={summary.error || baselineSummary.error}
            />
          </div>
        </div>

        {/* Full width so every format tile fits on one line (see RevenueSummaryCards). */}
        <div className="lg:col-span-3">
          <RevenueSummaryCards
            summaryByMode={summary.summaryByMode}
            baselineSummaryByMode={baseline && !baselineSummary.loading ? baselineSummary.summaryByMode : null}
            periodNames={periodNames}
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
            comparisonStart={baseline?.start ?? ''}
            comparisonEnd={baseline?.end ?? ''}
            compareShort={compareShort}
          />
        </div>
      </div>
    </PageLayout>
  );
}
