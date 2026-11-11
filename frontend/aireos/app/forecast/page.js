'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import PageLayout from '@/components/layout/PageLayout';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import ForecastTable from '@/components/forecast/ForecastTable';
import ForecastYearTotals from '@/components/forecast/ForecastYearTotals';
import { customerLabel } from '@/app/utils/retailerLabel';
import {
  FORECAST_TIER_OPTIONS,
  NO_DATA_FOR_TIER,
  forecastUpdatingBadge,
  initialMissingHint,
  initialStatusNotes,
  lineCoverageNote,
  yearsInRange,
} from '@/app/utils/forecastLineText';
import { lineCoverage } from '@/app/utils/forecastActuals';
import { ALL_TIERS, forecastModelView, parseTier, pastAccuracy, rowsForTier } from '@/app/utils/forecastTiers';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  buildMonthlyPoints,
  formatSgtTimestamp,
  toggleSelectedValue,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastInitialStatus from '@/hooks/useForecastInitialStatus';
import useForecastRefreshStatus from '@/hooks/useForecastRefreshStatus';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';

// useSearchParams (the ?tier= model) wants a Suspense boundary above it.
export default function ForecastPage() {
  return (
    <Suspense fallback={null}>
      <ForecastView />
    </Suspense>
  );
}

function ForecastView() {
  const filters = useForecastFilters();
  const { productName, customerName, startDate, endDate, ready } = filters;
  const [selectedPromoTypes, setSelectedPromoTypes] = useState(ALL_PROMO_TYPE_VALUES);
  const [selectedPackTypes, setSelectedPackTypes] = useState(ALL_PACK_TYPE_VALUES);
  const [visibleSeries, setVisibleSeries] = useState(ALL_SERIES_VISIBLE);
  // Every tier comes back in one request, so switching models redraws from
  // rows already here (utils/forecastTiers.js).
  const view = useForecastView({ ready, productName, customerName, startDate, endDate, tier: ALL_TIERS });
  const { rows: allRows, availability, actuals, promotions, freshness } = view.data;
  const error = filters.error ?? view.error;
  // Rows start empty, so the chart needs `loading` while the options are
  // still on their way too, or it would briefly claim there is no data.
  const loading = (!ready && filters.optionsLoading) || view.loading;

  // ---- Model (tier) ----------------------------------------------------

  // The model lives in the URL (?tier=tier0|tier1_basic|tier1_advanced), so
  // a link or a refresh keeps it. Tier 0 when missing or unknown.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTier = parseTier(searchParams.get('tier'));
  // One model for every scope, All customers included: never an average or
  // a mix of tiers (utils/forecastTiers.js).
  const model = forecastModelView({ rows: allRows, availability, requestedTier });
  const rows = model.rows;

  function setTier(tier) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tier', tier);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // A model that stops being available for the picked SKUs (the SKU filter
  // changed) falls back to Tier 0 on the chart at once (forecastModelView);
  // this keeps the URL, and so the dropdown, in step. Only once the new
  // filter's rows are in, so availability is for the SKUs now picked.
  const fellBack = model.tier !== requestedTier;
  useEffect(() => {
    if (!ready || view.loading || !fellBack || !model.tier) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tier', model.tier);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [ready, view.loading, fellBack, model.tier, searchParams, router, pathname]);

  const modelLabel = FORECAST_TIER_OPTIONS.find((option) => option.value === model.tier)?.label ?? '';

  // ---- Points ----------------------------------------------------------

  // Past accuracy and the Current dot bands describe one series, so they
  // only show once a single customer and SKU are picked.
  const singleSeries = Boolean(productName && customerName);
  // Volume only (cartons): the page shows no revenue.
  const points = buildMonthlyPoints(rows, actuals, 'units', { singleSeries });
  // "Next 12 months" is each SKU's whole Current line, which the date
  // filter can cut short (a Jan-Dec view of a line running Sep-Aug), so it
  // comes from the backend's total, not from the points in view.
  const horizon = view.data.horizon?.[model.tier] ?? null;
  const horizonVolume = horizon?.units ?? null;
  // When the selected model last produced its Current line
  // (MAX(current_generated_at) for that tier, see backend
  // forecast_service.forecast_stamps_from_rows). A retrain replaces the
  // Current line, so this is when the forecast last updated (shown as
  // "Forecast last updated").
  const lastRun = freshness.by_tier?.[model.tier]?.current_generated_at ?? null;
  const salesLabel = customerName ? `${customerLabel(customerName)} sales` : 'All customers sales';
  const accuracy = singleSeries ? pastAccuracy(rows) : null;
  // Year cards always cover Jan-Dec, so they fetch a wider window than the
  // date filter when the filter cuts a year short; that fetch has every tier
  // too, and mapRows keeps the same model's rows.
  const { years: yearTotals, loading: yearTotalsLoading } = useForecastYearTotals({
    ready,
    productName,
    customerName,
    startDate,
    endDate,
    bounds: filters.bounds,
    rows: allRows,
    actuals,
    tier: ALL_TIERS,
    mapRows: (forecastRows) => rowsForTier(forecastRows, model.tier),
  });

  // ---- Notes under the chart -------------------------------------------

  // Both are best-effort extras: a failed read just leaves them out.
  const { data: initialMeta } = useForecastInitialStatus();
  const { data: refreshStatus } = useForecastRefreshStatus();
  const updatingBadge = forecastUpdatingBadge(refreshStatus, initialMeta);
  const initialNotes = initialStatusNotes({
    rangeYears: yearsInRange(startDate, endDate),
    meta: initialMeta,
    formatStamp: formatSgtTimestamp,
  });
  // Initial and Previous are per SKU and tier. None of the customer x SKUs
  // in scope has one on this model: its pill is greyed out (its hover says
  // why). Some have one: a note, so the partial sum is never silent.
  const initialCoverage = lineCoverage(rows, 'forecast_initial');
  const previousCoverage = lineCoverage(rows, 'forecast_previous');
  const initialOff =
    initialCoverage.total > 0 && initialCoverage.withLine === 0
      ? initialMissingHint({
          tier: model.tier,
          years: yearsInRange(startDate, endDate),
          skuCount: initialCoverage.total,
        })
      : '';
  const previousOff = previousCoverage.withLine === 0;
  const modelNotes = [
    lineCoverageNote('Initial yearly forecast', initialCoverage),
    lineCoverageNote('Previous', previousCoverage),
  ].filter(Boolean);

  // The monthly table shows the lines the chart shows: a pill greyed out for
  // a missing Initial / Previous is off there too (as in ForecastChart).
  const tableSeries = {
    ...visibleSeries,
    ...(previousOff ? { previous: false } : {}),
    ...(initialOff ? { initial: false } : {}),
  };
  const hasTableColumn = Object.values(tableSeries).some(Boolean);
  // `loading` too: while the page refetches, the year figures still hold the
  // previous filter's months, and a total from those would be wrong rather
  // than merely stale.
  const yearTotalsBusy = yearTotalsLoading || loading;

  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerName ? customerLabel(customerName) : 'All customers' },
    { label: 'Model', value: modelLabel },
  ];

  return (
    <PageLayout title="Sell-Out Forecast">
      <div className="min-w-0 space-y-3">
        {error && (
          <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
            {error}
          </p>
        )}

        <ForecastFilters
          productName={productName}
          onProductNameChange={filters.setProductName}
          productOptions={filters.productOptions}
          customerName={customerName}
          onCustomerNameChange={filters.setCustomerName}
          customerOptions={filters.customerOptions}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          minDate={filters.bounds.start}
          maxDate={filters.bounds.end}
          onClearFilters={filters.clear}
          canClearFilters={filters.canClear}
          model={{
            value: model.tier,
            onChange: setTier,
            options: model.options,
          }}
        />

        <ForecastChart
          points={points}
          startDate={startDate}
          endDate={endDate}
          singleSeries={singleSeries}
          scopeTags={scopeTags}
          promotions={promotions}
          selectedPromoTypes={selectedPromoTypes}
          onTogglePromoType={(value) =>
            setSelectedPromoTypes((current) => toggleSelectedValue(current, value))
          }
          selectedPackTypes={selectedPackTypes}
          onTogglePackType={(value) =>
            setSelectedPackTypes((current) => toggleSelectedValue(current, value))
          }
          visibleSeries={visibleSeries}
          onToggleSeries={(key) => setVisibleSeries((current) => toggleSeriesVisibility(current, key))}
          lastRun={lastRun}
          salesLabel={salesLabel}
          salesLoadedAt={freshness.latest_sales_loaded_at}
          pastAccuracy={accuracy}
          updatingBadge={updatingBadge}
          initialNotes={initialNotes}
          initialMissingHint={initialOff}
          previousMissing={previousOff}
          confidenceDots={singleSeries}
          notes={modelNotes}
          emptyMessage={allRows.length ? NO_DATA_FOR_TIER : undefined}
          loading={loading}
        />

        {/* Each table is a card of its own under the chart card, as on the
            other pages -- never a table inside the chart's card. */}
        {yearTotalsBusy || yearTotals.length ? (
          <TableCard
            label="Full-year totals"
            header={<TableCardHeader title="Full-year totals" detail={<>Actual and forecast volume in cartons for each calendar year in view{modelLabel ? ` · ${modelLabel}` : ''}</>} />}
          >
            <ForecastYearTotals years={yearTotals} loading={yearTotalsBusy} horizonVolume={horizonVolume} />
          </TableCard>
        ) : null}

        {points.length > 0 && hasTableColumn ? (
          <ForecastTable points={points} visibleSeries={tableSeries} modelLabel={modelLabel} />
        ) : null}
      </div>
    </PageLayout>
  );
}
