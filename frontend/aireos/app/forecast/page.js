'use client';

import { useState } from 'react';

import PageLayout from '@/components/layout/PageLayout';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  buildMonthlyPoints,
  forecastConfidence,
  sumHorizonForecast,
  toggleSelectedValue,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';

export default function ForecastPage() {
  const filters = useForecastFilters();
  const { productName, customerName, startDate, endDate, ready } = filters;
  const [metric, setMetric] = useState('units');
  const [selectedPromoTypes, setSelectedPromoTypes] = useState(ALL_PROMO_TYPE_VALUES);
  const [selectedPackTypes, setSelectedPackTypes] = useState(ALL_PACK_TYPE_VALUES);
  const [visibleSeries, setVisibleSeries] = useState(ALL_SERIES_VISIBLE);
  const view = useForecastView({ ready, productName, customerName, startDate, endDate });
  const { rows, actuals, promotions, freshness } = view.data;
  const error = filters.error ?? view.error;
  // Rows start empty, so the chart needs `loading` while the options are
  // still on their way too, or it would briefly claim there is no data.
  const loading = (!ready && filters.optionsLoading) || view.loading;

  // The 80% range, confidence and promo situation describe one series, so
  // they only show once a single customer and SKU are picked.
  const singleSeries = Boolean(productName && customerName);
  // Same rows the chart plots. Volume and revenue are both summed so the
  // year strip can show the next-12-month total beside the year, whichever
  // metric the chart tab is on.
  const unitPoints = buildMonthlyPoints(rows, actuals, 'units', { singleSeries });
  const revenuePoints = buildMonthlyPoints(rows, actuals, 'revenue', { singleSeries });
  const points = metric === 'revenue' ? revenuePoints : unitPoints;
  const horizonVolume = sumHorizonForecast(unitPoints);
  const horizonRevenue = sumHorizonForecast(revenuePoints);
  // When the pipeline produced the Current line for this customer
  // (MAX(current_generated_at) over the fetched rows, see backend
  // forecast_service.forecast_stamps_from_rows).
  // previous_generated_at is archived with the Previous line; it still
  // arrives in `freshness` for when that line comes back.
  const lastRun = freshness.current_generated_at;
  const salesLabel = customerName ? `${retailerLabel(customerName)} sales` : 'All customers sales';
  const confidence = singleSeries ? forecastConfidence(rows) : null;
  // Year cards always cover Jan-Dec, so they fetch a wider window than the
  // date filter when the filter cuts a year short.
  const { years: yearTotals, loading: yearTotalsLoading } = useForecastYearTotals({
    ready,
    productName,
    customerName,
    startDate,
    endDate,
    bounds: filters.bounds,
    rows,
    actuals,
  });

  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : 'All customers' },
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
          confidence={confidence}
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
