'use client';

import { useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/layout/PageLayout';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { getForecastOptions, getForecastRows } from '@/app/services/forecastApi';
import { retailerLabel } from '@/app/utils/promotionForm';
import {
  ALL_SERIES_VISIBLE,
  DEFAULT_FORECAST_TIER,
  buildMonthlyPoints,
  formatGeneratedAt,
  getRunDates,
  sumHorizonForecast,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';

export default function ForecastPage() {
  const [productName, setProductName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [metric, setMetric] = useState('units');
  const [tier, setTier] = useState(DEFAULT_FORECAST_TIER);
  const [promoType, setPromoType] = useState('');
  const [visibleSeries, setVisibleSeries] = useState(ALL_SERIES_VISIBLE);
  const [productOptions, setProductOptions] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [dateBounds, setDateBounds] = useState({ start: '', end: '' });
  const [rows, setRows] = useState([]);
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
        setStartDate(start);
        setEndDate(end);
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
        const nextRows = await getForecastRows({
          productName,
          customerName,
          startDate,
          endDate,
        });
        if (cancelled) return;
        setRows(nextRows);
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
  }, [ready, productName, customerName, startDate, endDate]);

  const points = useMemo(() => buildMonthlyPoints(rows, metric), [rows, metric]);
  const { current } = getRunDates(rows);
  const horizonTotal = sumHorizonForecast(points);

  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : 'All customers' },
  ];

  function clearFilters() {
    setProductName('');
    setCustomerName('');
    setStartDate(dateBounds.start);
    setEndDate(dateBounds.end);
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
          horizonTotal={horizonTotal}
          metric={metric}
          generatedAtLabel={formatGeneratedAt(current)}
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
          promoType={promoType}
          onPromoTypeChange={setPromoType}
          visibleSeries={visibleSeries}
          onToggleSeries={(key) => setVisibleSeries((current) => toggleSeriesVisibility(current, key))}
        />
      </div>
    </PageLayout>
  );
}
