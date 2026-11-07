'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import PageLayout from '@/components/layout/PageLayout';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  ALL_MODELS_AVERAGE_LABEL,
  ALL_MODELS_AVERAGE_NOTE,
  FORECAST_TIER_OPTIONS,
  NO_DATA_FOR_TIER,
  forecastUpdatingBadge,
  initialPartialNote,
  initialStatusNotes,
  yearsInRange,
} from '@/app/utils/forecastLineText';
import {
  ALL_TIERS,
  averageAcrossTiers,
  forecastModelView,
  parseTier,
  pastAccuracy,
  rowsForTier,
} from '@/app/utils/forecastTiers';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  buildMonthlyPoints,
  formatSgtTimestamp,
  sumHorizonForecast,
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
  const [metric, setMetric] = useState('units');
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
  const model = forecastModelView({ rows: allRows, availability, requestedTier, customerName });
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
  const fellBack = model.mode === 'tier' && model.tier !== requestedTier;
  useEffect(() => {
    if (!ready || view.loading || !fellBack || !model.tier) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tier', model.tier);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [ready, view.loading, fellBack, model.tier, searchParams, router, pathname]);

  const modelLabel =
    model.mode === 'tier'
      ? FORECAST_TIER_OPTIONS.find((option) => option.value === model.tier)?.label ?? ''
      : ALL_MODELS_AVERAGE_LABEL;

  // ---- Points ----------------------------------------------------------

  // The 80% range and Past accuracy describe one series, so they only show
  // once a single customer and SKU are picked.
  const singleSeries = Boolean(productName && customerName);
  // Same rows the chart plots. Volume and revenue are both summed so the
  // year strip can show the next-12-month total beside the year, whichever
  // metric the chart tab is on.
  const unitPoints = buildMonthlyPoints(rows, actuals, 'units', { singleSeries });
  const revenuePoints = buildMonthlyPoints(rows, actuals, 'revenue', { singleSeries });
  const points = metric === 'revenue' ? revenuePoints : unitPoints;
  const horizonVolume = sumHorizonForecast(unitPoints);
  const horizonRevenue = sumHorizonForecast(revenuePoints);
  // When the selected model last produced its Current line
  // (MAX(current_generated_at) for that tier, see backend
  // forecast_service.forecast_stamps_from_rows); across every tier for the
  // All customers average. A retrain replaces the Current line, so this is
  // when the forecast last updated (shown as "Forecast last updated").
  const lastRun =
    model.mode === 'tier'
      ? freshness.by_tier?.[model.tier]?.current_generated_at ?? null
      : freshness.current_generated_at;
  const salesLabel = customerName ? `${retailerLabel(customerName)} sales` : 'All customers sales';
  const accuracy = singleSeries && model.mode === 'tier' ? pastAccuracy(rows) : null;
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
    mapRows: (forecastRows) =>
      model.mode === 'tier' ? rowsForTier(forecastRows, model.tier) : averageAcrossTiers(forecastRows),
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
  // No Initial at all on this model greys out its pill (its hover says why);
  // some SKUs without one is a note, so the partial sum is never silent.
  const initialMissing = model.mode === 'tier' && model.initial.total > 0 && model.initial.withInitial === 0;
  const modelNotes = [
    model.mode === 'average' ? ALL_MODELS_AVERAGE_NOTE : '',
    model.mode === 'tier' ? initialPartialNote(model.initial) : '',
  ].filter(Boolean);

  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : 'All customers' },
    { label: 'Model', value: modelLabel },
  ];

  return (
    <PageLayout title="Sell-Out Forecast">
      <div className="space-y-1">
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
            value: model.tier ?? '',
            onChange: setTier,
            options: model.options,
            disabled: model.mode === 'average',
            placeholder: ALL_MODELS_AVERAGE_LABEL,
          }}
        />

        <ForecastChart
          points={points}
          startDate={startDate}
          endDate={endDate}
          metric={metric}
          onMetricChange={setMetric}
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
          initialMissing={initialMissing}
          notes={modelNotes}
          modelLabel={modelLabel}
          emptyMessage={model.mode === 'tier' && allRows.length ? NO_DATA_FOR_TIER : undefined}
          yearTotals={yearTotals}
          yearTotalsLoading={yearTotalsLoading}
          horizonVolume={horizonVolume}
          horizonRevenue={horizonRevenue}
          loading={loading}
        />
      </div>
    </PageLayout>
  );
}
