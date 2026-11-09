'use client';

import { useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DashboardStatus from "@/components/dashboard/DashboardStatus";
import ChannelSwitch from "@/components/dashboard/ChannelSwitch";
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
import useAllCustomers from "@/hooks/useAllCustomers";
import useMonthlyOnly from "@/hooks/useMonthlyOnly";
import usePriceMix from "@/hooks/usePriceMix";
import useCustomerTotals from "@/hooks/useCustomerTotals";
import useCustomerTrends from "@/hooks/useCustomerTrends";
import {
  DEFAULT_COMPARE,
  alignComparisonBuckets,
  comparisonSetup,
  sumPeriodTotals,
} from "@/app/utils/periodComparison";
import { DEFAULT_PRESET_ID, buildDateRangePresets } from "@/app/utils/dateRangePresets";
import { rangeHasWeeklyMonths, weeklyGapMessage } from "@/app/utils/weeklyGaps";
import { customerColorOrder, relabelFormatRows } from "@/app/utils/storeFormats";
import { isWithinData } from "@/app/utils/dataBounds";

const NO_CUSTOMERS = [];

// The customers ticked when the options first load, and after Clear: every
// customer (there is no cap; the chart turns to lines past its bar limit).
function defaultCustomers(options) {
  return options.map((option) => option.value);
}

export default function DashboardPage() {
  const { channels, dataVersion, refreshing } = useDataFreshness();

  // Customer ticks. null until the options arrive, then every customer is
  // ticked. [] is the user clearing every tick
  // from the menu, and must not be filled back in on its own. Clear in the
  // filter card is the one action that ticks every customer again. The rest
  // of the page still reads one customer: the first ticked name in the
  // option list. The chart reads `customers` once two or more are ticked.
  const { options: customerOptions, loading: customerOptionsLoading, error: customerOptionsError } =
    useCustomerOptions({ dataVersion });
  // Only sets colours, so a failed read just leaves the customers with sales in
  // order, each still with its own colour, rather than an error on the page.
  const { customers: allCustomers, loading: allCustomersLoading } = useAllCustomers({ dataVersion });
  // Matched to the customer records by customer_id, not by name (see customerColorOrder).
  const colorOrder = customerColorOrder(allCustomers, customerOptions);
  const [selectedCustomers, setSelectedCustomers] = useState(null);
  if (selectedCustomers === null && customerOptions.length > 0) {
    setSelectedCustomers(defaultCustomers(customerOptions));
  }
  // In the filter list's order, not the order they were ticked, so the chart,
  // its legend and its tooltip list customers the way the filter does.
  const customers = selectedCustomers
    ? customerOptions.filter((option) => selectedCustomers.includes(option.value)).map((option) => option.value)
    : NO_CUSTOMERS;
  const customer = customerOptions.find((option) => customers.includes(option.value))?.value ?? '';
  const comparingCustomers = customers.length > 1;

  // Switching the single customer drops the SKU, because that code may not
  // exist for the new customer. A store code belongs to one customer, so it
  // is cleared whenever more than one customer is ticked. Period stays.
  function handleCustomersChange(next) {
    const previousSingle = customers.length === 1 ? customers[0] : null;
    const nextSingle = next.length === 1 ? next[0] : null;
    setSelectedCustomers(next);
    if (previousSingle && nextSingle && previousSingle !== nextSingle) clearSku();
    // A store belongs to one customer, and "Compare to" compares one
    // customer's periods. Neither applies once the chart compares customers.
    if (next.length !== 1) {
      clearStore();
      setCompareTo(DEFAULT_COMPARE);
      setCustomCompare({ start: '', end: '' });
    }
  }

  const [sku, setSku] = useState('');
  const [skuLabel, setSkuLabel] = useState('');
  const [store, setStore] = useState('');
  const [storeLabel, setStoreLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState('offline');
  // `{customer}_online` is absent from the freshness map when that channel
  // has no sell-out rows (NHG). Online is disabled only once that map has
  // loaded, and only when every ticked customer is offline-only.
  const freshnessLoaded = Object.keys(channels).length > 0;
  const onlineAvailable = customers.some((name) => Boolean(channels[`${name}_online`]));
  if (freshnessLoaded && mode === 'online' && customers.length > 0 && !onlineAvailable) {
    handleModeChange('offline');
  }

  // A store is sold through one channel, and the Store list shows only the
  // chart's channel (DashboardFilters), so a store picked on one channel is
  // not a choice on the other: switching drops it.
  function handleModeChange(next) {
    if (next === mode) return;
    setMode(next);
    clearStore();
  }
  // "Compare to" baseline — none by default (DEFAULT_COMPARE); Clear Filters
  // returns to that. `customCompare` is only used while compareTo is
  // 'custom'.
  const [compareTo, setCompareTo] = useState(DEFAULT_COMPARE);
  // The chart's Revenue / Volume switch ('revenue' | 'units'). Here, not in
  // the card, because the comparison rows below are built for it.
  const [metric, setMetric] = useState('revenue');
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

  // Every preset (and the Latest month default) is anchored to the month of
  // the latest loaded PREFERRED period for this channel — see
  // dateRangePresets.js. "start" is a week's start when weekly data is the
  // newest, or a whole month's start when a monthly total is (e.g. August
  // 2026). latestDataEnd is the real last day loaded either way;
  // comparisonRange and the Period control use it instead of assuming
  // +6 days. Weeks are lined up on latestWeekStart instead, the latest
  // GENUINE weekly row: anchoring them on a monthly total's start (Aug 1, a
  // Saturday) put every week on the wrong weekday, so a Jul 30 – Aug 5 week
  // was labelled "Aug 1 – Aug 7" and paired with the wrong weeks.
  // The latest loaded period is read across every ticked customer, so one
  // whose data stops sooner (FairPrice at August) doesn't hold the default
  // month and the month picker back while others have September or October.
  // Sent as ticked, without waiting for the freshness map: a customer with no
  // retailer on this channel (NHG online) just matches no rows, and the page
  // already switches to Offline when no ticked customer sells online.
  const {
    start: latestPeriodStart,
    end: latestDataEnd,
    earliestStart: earliestDataStart,
    latestWeekStart: latestGenuineWeekStart,
  } = useDefaultDateRange({ customer, customers, mode, dataVersion, period: 'week' });
  const latestWeekStart = latestGenuineWeekStart || latestPeriodStart;
  const presets = buildDateRangePresets(latestPeriodStart);
  const defaultRange = presets.find((preset) => preset.id === DEFAULT_PRESET_ID) ?? { start: '', end: '' };

  // A picked Period only applies while it is inside the ticked customers'
  // data: switching from Prime (data to Oct) to FairPrice (to Aug) would
  // otherwise leave the page on an empty October the picker no longer
  // offers. Outside it, the page falls back to the default (Latest month);
  // the pick is kept, so ticking Prime again brings it back.
  const hasExplicitDateFilter =
    Boolean(startDate && endDate) && isWithinData({ start: startDate, end: endDate }, earliestDataStart, latestDataEnd);
  const effectiveStartDate = hasExplicitDateFilter ? startDate : defaultRange.start;
  const effectiveEndDate = hasExplicitDateFilter ? endDate : defaultRange.end;

  // What the page can show yet. 'loading' until the customer list and the
  // latest loaded period arrive: every section draws its placeholder then,
  // never its "nothing here" message. 'failed' (the list couldn't be read)
  // and 'empty' (no sales uploaded at all) show one DashboardStatus card
  // instead of the sections.
  // Also 'loading' until every customer is in (useAllCustomers), since that
  // list sets each customer's colour (customerColorOrder, by customer id):
  // drawing before it would colour customers in the dropdown's order first
  // and then switch. A failed read ends the wait (colours then follow the
  // dropdown), and a later dataVersion refetch does not bring it back.
  let pageStatus = 'ready';
  if (customerOptionsError && customerOptions.length === 0) pageStatus = 'failed';
  else if (customerOptionsLoading || allCustomersLoading) pageStatus = 'loading';
  else if (customerOptions.length === 0) pageStatus = 'empty';
  else if (customers.length > 0 && !latestPeriodStart) pageStatus = 'loading';
  const pageLoading = pageStatus === 'loading';

  const rangeInputs = {
    start: effectiveStartDate,
    end: effectiveEndDate,
    latestWeekStart,
    latestDataEnd,
    custom: customCompare,
  };
  // Likewise a Compare to whose period is outside the data (Same period last
  // year after switching to a customer whose data starts this year) shows
  // as no comparison rather than comparing against nothing.
  const chosenComparison = comparisonSetup(compareTo, rangeInputs);
  const comparisonFits =
    !chosenComparison.baseline || isWithinData(chosenComparison.baseline, earliestDataStart, latestDataEnd);
  const effectiveCompareTo = comparisonFits ? compareTo : DEFAULT_COMPARE;
  const { options: compareOptions, baseline, periodNames } = comparisonFits
    ? chosenComparison
    : comparisonSetup(DEFAULT_COMPARE, rangeInputs);
  const compareShort = baseline ? `vs ${periodNames.baseline}` : '';

  // Some months are loaded only as monthly totals (e.g. August 2026), and a
  // weekly summary leaves them out. Checked for both sides of a comparison
  // before picking the granularity, so either side being month-only puts
  // both on month bars instead of leaving one side empty.
  // Every ticked customer, like the date range above: the latest month can
  // come from any of them, so By week is judged across all of them too.
  const currentMonthlyOnly = useMonthlyOnly({
    dataVersion,
    customer,
    customers,
    store,
    sku,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
  });
  const baselineMonthlyOnly = useMonthlyOnly({
    dataVersion,
    customer,
    customers,
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

  // Monthly figures are the main view (the client works in months), so the
  // chart always opens By month. By week is a drill-down into the same
  // months, offered only when at least one of them has weekly rows; the
  // choice lasts until the range changes (handleDateRangeChange).
  const weekAvailable = rangeHasWeeklyMonths(
    effectiveStartDate,
    effectiveEndDate,
    currentMonthlyOnly.data?.[mode] ?? [],
  );
  const chartGranularity = weekAvailable ? (granularityChoice ?? 'month') : 'month';
  // The user picked By week over monthly-only data — the weekly chart is
  // missing those months. Name exactly which ones (not the whole period), so
  // users know what weekly data to upload; never fabricate weekly bars.
  const weeklyGap = chartGranularity === 'week' ? weeklyGapMessage(monthlyOnlyMonths) : null;
  // Both sides of a comparison read the same kind of data as the chart: by
  // month, each month's uploaded monthly total (its weeks added up only where
  // no monthly total exists); by week, weekly rows. Mixing them compared
  // one month's monthly total with another's weekly rows, which don't tally
  // (weeks straddle month ends), and could show a fall where the chart
  // showed a rise. The one exception: when this period runs past the loaded
  // data (trimmedTo), its last month is partial weekly data, so the baseline
  // is read by week too, cut to the same weeks — unless it only has monthly
  // data, which has no weeks to cut.
  const baselineGranularity =
    chartGranularity === 'month' && (!baseline?.trimmedTo || hasMonthlyOnly) ? 'month' : 'week';

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

  const customerTotals = useCustomerTotals({
    dataVersion,
    customers,
    sku,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    enabled: comparingCustomers,
  });

  // The chart's figures per customer per week or month; the tiles and the
  // customer ranking keep customerTotals, one total per customer.
  const customerTrends = useCustomerTrends({
    dataVersion,
    customers,
    granularity: chartGranularity,
    sku,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    enabled: comparingCustomers && !granularityPending,
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
  const currentFormatRows = summary.summaryByMode[mode]?.periodByFormat ?? [];
  const baselineFormatRows = baseline ? (baselineSummary.summaryByMode[mode]?.periodByFormat ?? []) : [];
  const comparisonRows = baseline
    ? alignComparisonBuckets(currentTotals, baselineTotals, {
        compareTo: effectiveCompareTo,
        granularity: chartGranularity,
        baselineGranularity,
        currentStart: effectiveStartDate,
        currentEnd: effectiveEndDate,
        baselineStart: baseline.start,
        latestWeekStart,
        currentByFormat: relabelFormatRows(currentFormatRows, baselineFormatRows),
        metric,
        baselineWeeksByFormat: relabelFormatRows(baselineFormatRows, currentFormatRows),
      })
    : null;
  const lastUpdated = customers
    .map((name) => channels[`${name}_${mode}`])
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

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
    // Clear puts back the customers the filter box opens with, including
    // when only one customer was chosen.
    if (customerOptions.length > 0) {
      setSelectedCustomers(defaultCustomers(customerOptions));
    }
  }

  const badges = [
    sku && <FilterBadge key="sku" label={`SKU: ${skuLabel || sku}`} onClear={clearSku} />,
    store && <FilterBadge key="store" label={`Store: ${storeLabel || store}`} onClear={clearStore} />,
  ].filter(Boolean);

  return (
    <PageLayout
      title="Sales Dashboard"
    >
      {(pageStatus === 'failed' || pageStatus === 'empty') ? (
        <DashboardStatus kind={pageStatus} error={customerOptionsError} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RevenueTrendCard
              summaryByMode={summary.summaryByMode}
              loading={pageLoading || (customers.length === 0 ? false : (comparingCustomers ? customerTrends.loading : summary.loading))}
              refreshing={summary.refreshing}
              error={customers.length === 0 ? null : (comparingCustomers ? customerTrends.error : (summary.error || (baseline ? baselineSummary.error : null)))}
              freshnessRefreshing={refreshing}
              lastUpdated={lastUpdated}
              weeklyGap={weeklyGap}
              weekAvailable={weekAvailable}
              mode={mode}
              granularity={chartGranularity}
              onGranularityChange={setGranularityChoice}
              comparisonRows={comparingCustomers ? null : comparisonRows}
              periodNames={periodNames}
              comparisonLoading={baselineSummary.loading}
              customerBars={customers.length === 0 ? [] : (comparingCustomers ? customerTrends.rows : null)}
              customerColorOrder={colorOrder}
              metric={metric}
              onMetricChange={setMetric}
              channelSwitch={
                <ChannelSwitch
                  mode={mode}
                  onChange={handleModeChange}
                  onlineEnabled={!freshnessLoaded || onlineAvailable}
                />
              }
              headerExtra={
                <PeriodControls
                  start={effectiveStartDate}
                  end={effectiveEndDate}
                  presets={presets}
                  earliestDataStart={earliestDataStart}
                  latestDataEnd={latestDataEnd}
                  onDateRangeChange={handleDateRangeChange}
                  compareTo={effectiveCompareTo}
                  compareOptions={compareOptions}
                  compareDisabled={comparingCustomers}
                  onCompareChange={handleCompareChange}
                />
              }
            />
          </div>

          {/* Right column: scope (Filters) then the headline change (Comparison),
              stacked beside the chart they explain. A grid rather than flex so
              the Comparison card's h-full fills whatever height the chart row
              leaves under the Filters. */}
          <div className="grid grid-rows-[auto_1fr] gap-3">
            <div>
              <DashboardFilters
                customerControl={
                  <CustomerSelector
                    selected={customers}
                    onChange={handleCustomersChange}
                    options={customerOptions}
                    loading={customerOptionsLoading}
                    error={customerOptionsError}
                  />
                }
                sku={sku}
                onSkuChange={handleSkuChange}
                customers={customers}
                customer={customer}
                mode={mode}
                storeDisabled={customers.length !== 1}
                store={store}
                onStoreChange={handleStoreChange}
                hasPeriodChanges={hasExplicitDateFilter || effectiveCompareTo !== DEFAULT_COMPARE}
                customersFiltered={customerOptions.length > 0 && customers.length !== customerOptions.length}
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
              loading={pageLoading || (comparingCustomers ? customerTotals.loading : summary.loading)}
              error={comparingCustomers ? customerTotals.error : summary.error}
              mode={mode}
              comparingCustomers={comparingCustomers}
              customerRows={customerTotals.rows}
              // Not while the page loads: the selection is empty only because
              // the default customers aren't picked yet, not because the user
              // unticked them all.
              noCustomers={!pageLoading && customers.length === 0}
              customerColorOrder={colorOrder}
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
              comparingCustomers={comparingCustomers}
              customers={customers}
              customerRows={customerTotals.rows}
              customerRowsLoading={customerTotals.loading}
              customerRowsError={customerTotals.error}
              customerColorOrder={colorOrder}
              loading={pageLoading}
            />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
