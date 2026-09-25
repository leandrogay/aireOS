'use client';

import { useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/layout/PageLayout';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import InventoryTable from '@/components/forecast/InventoryTable';
import { getForecastOptions, getForecastRows, getInventoryPosition } from '@/app/services/forecastApi';
import { retailerLabel } from '@/app/utils/promotionForm';
import {
  ALL_SERIES_VISIBLE,
  DEFAULT_FORECAST_TIER,
  buildMonthlyPoints,
  currentYearDateRange,
  formatGeneratedAt,
  getRunDates,
  resolveTier,
  sumHorizonForecast,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';
import { buildInventoryPoints } from '@/app/utils/inventoryView';

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
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState(null);

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
        // Default view is the current year only -- past years (e.g. 2024,
        // 2025) show once the user widens the date filter themselves; the
        // picker's own min/max still come from dateBounds (the full range).
        const defaultRange = currentYearDateRange({ start, end });
        setStartDate(defaultRange.start);
        setEndDate(defaultRange.end);
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

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    async function loadInventory() {
      setInventoryLoading(true);
      try {
        const nextRows = await getInventoryPosition({
          productName,
          customerName,
          startDate,
          endDate,
        });
        if (cancelled) return;
        setInventoryRows(nextRows);
        setInventoryError(null);
      } catch (err) {
        if (!cancelled) setInventoryError(err.message);
      } finally {
        if (!cancelled) setInventoryLoading(false);
      }
    }

    loadInventory();
    return () => {
      cancelled = true;
    };
  }, [ready, productName, customerName, startDate, endDate]);

  const resolvedRows = useMemo(() => resolveTier(rows, tier), [rows, tier]);
  const points = useMemo(() => buildMonthlyPoints(resolvedRows, metric), [resolvedRows, metric]);
  const { current } = getRunDates(resolvedRows);
  const horizonTotal = sumHorizonForecast(points);
  const inventoryPoints = useMemo(() => buildInventoryPoints(inventoryRows), [inventoryRows]);

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

        {inventoryError && (
          <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
            {inventoryError}
          </p>
        )}
        {inventoryLoading && !inventoryError && (
          <p className="text-xs text-muted-foreground">Loading inventory position…</p>
        )}
        {!inventoryLoading && !inventoryError && inventoryPoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No inventory position yet for this selection.
          </p>
        ) : (
          <InventoryTable points={inventoryPoints} />
        )}
      </div>
    </PageLayout>
  );
}
