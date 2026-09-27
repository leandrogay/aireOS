'use client';

import { useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/layout/PageLayout';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { getForecastOptions, getForecastView } from '@/app/services/forecastApi';
import { retailerLabel } from '@/app/utils/promotionForm';
import { currentYearDateRange, readForecastDateSession, writeForecastDateSession } from '@/app/utils/dateRange';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  DEFAULT_FORECAST_TIER,
  FORECAST_TIERS,
  buildMonthlyPoints,
  formatTimestamp,
  sumHorizonForecast,
  toggleSelectedValue,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';

export default function ForecastPage() {
  const [productName, setProductName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [metric, setMetric] = useState('units');
  const [tier, setTier] = useState(DEFAULT_FORECAST_TIER);
  const [selectedPromoTypes, setSelectedPromoTypes] = useState(ALL_PROMO_TYPE_VALUES);
  const [selectedPackTypes, setSelectedPackTypes] = useState(ALL_PACK_TYPE_VALUES);
  const [visibleSeries, setVisibleSeries] = useState(ALL_SERIES_VISIBLE);
  const [productOptions, setProductOptions] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [dateBounds, setDateBounds] = useState({ start: '', end: '' });
  const [rows, setRows] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [freshness, setFreshness] = useState({
    forecast_by_tier: {},
    latest_sales_loaded_at: null,
  });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const options = await getForecastOptions();
        if (cancelled) return;
        const products = options.products ?? [];
        const customers = options.customers ?? [];
        const start = options.start_date ?? '';
        const end = options.end_date ?? '';
        setProductOptions(products);
        setCustomerOptions(customers);
        setDateBounds({ start, end });
        setProductName('');
        setCustomerName(customers[0] ?? '');
        // Current-year default is for a new browser tab/session only.
        // A date the user already picked in this tab stays put when they
        // leave Forecast and come back, or change other filters.
        const defaultRange = currentYearDateRange({ start, end });
        const savedRange = readForecastDateSession();
        setStartDate(savedRange?.start ?? defaultRange.start);
        setEndDate(savedRange?.end ?? defaultRange.end);
        setError(null);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    async function loadRows() {
      setLoading(true);
      try {
        const payload = await getForecastView({
          productName,
          customerName,
          startDate,
          endDate,
          tier,
        });
        if (cancelled) return;
        // The mock table may have no Tier 1 rows. Bounce the toggle to
        // Tier 0 so the user sees that model's results instead of an
        // empty chart -- the effect re-runs with tier=0.
        if (tier === 1 && !(payload.rows ?? []).length) {
          setTier(0);
          return;
        }
        setRows(payload.rows);
        setActuals(payload.actuals);
        setPromotions(payload.promotions);
        setFreshness(
          payload.freshness ?? { forecast_by_tier: {}, latest_sales_loaded_at: null }
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRows();
    return () => {
      cancelled = true;
    };
  }, [ready, productName, customerName, startDate, endDate, tier]);

  useEffect(() => {
    if (!ready || !startDate || !endDate) return;
    writeForecastDateSession(startDate, endDate);
  }, [ready, startDate, endDate]);

  const points = useMemo(
    () => buildMonthlyPoints(rows, actuals, metric),
    [rows, actuals, metric]
  );
  const horizonTotal = sumHorizonForecast(points);
  const freshnessItems = [
    ...FORECAST_TIERS.map((option) => ({
      label: `${option.label} forecast`,
      value: formatTimestamp(freshness.forecast_by_tier?.[String(option.value)]),
    })),
    {
      label: customerName ? `${retailerLabel(customerName)} sales` : 'All customers sales',
      value: formatTimestamp(freshness.latest_sales_loaded_at),
    },
  ];

  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : 'All customers' },
  ];

  // The "default" state is the current year, not the full dateBounds range --
  // canClearFilters must compare against that, or Clear would look active
  // on a freshly loaded page that hasn't been touched yet.
  const defaultDateRange = currentYearDateRange(dateBounds);
  const canClearFilters = Boolean(
    productName || customerName || startDate !== defaultDateRange.start || endDate !== defaultDateRange.end
  );

  function clearFilters() {
    setProductName('');
    setCustomerName('');
    setStartDate(defaultDateRange.start);
    setEndDate(defaultDateRange.end);
  }

  return (
    <PageLayout title="Forecast">
      <div className="space-y-2">
        {error && (
          <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
            {error}
          </p>
        )}
        {loading && !error && (
          <p className="text-xs text-muted-foreground">Loading forecast from BigQuery…</p>
        )}

        <ForecastFilters
          productName={productName}
          onProductNameChange={setProductName}
          productOptions={productOptions}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          customerOptions={customerOptions}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          minDate={dateBounds.start}
          maxDate={dateBounds.end}
          onClearFilters={clearFilters}
          canClearFilters={canClearFilters}
          horizonTotal={horizonTotal}
          metric={metric}
          tier={tier}
          onTierChange={setTier}
        />

        <ForecastChart
          points={points}
          startDate={startDate}
          endDate={endDate}
          metric={metric}
          onMetricChange={setMetric}
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
          freshnessItems={freshnessItems}
        />
      </div>
    </PageLayout>
  );
}
