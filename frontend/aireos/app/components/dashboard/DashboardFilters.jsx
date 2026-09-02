'use client';

import { useEffect, useState } from 'react';
import useDraftDateRange from '@/hooks/useDraftDateRange';

const COMPARISON_TYPES = [
  { value: 'wow', label: 'WoW' },
  { value: 'mom', label: 'MoM' },
  { value: 'yoy', label: 'YoY' },
];

function toggleButtonClass(isActive) {
  return `px-2 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
    isActive
      ? 'bg-deep-violet-blue text-white border-deep-violet-blue'
      : 'bg-white text-deep-violet-blue border-violet hover:bg-lavander'
  }`;
}

// "Filter" side panel for the sales dashboard: SKU, Store, and Date Range
// controls, plus the period-comparison type toggle and its "vs." previous-
// period range — every control that scopes the whole dashboard lives here
// together. `customer` (the page-header retailer-family selector) scopes
// both dropdowns' own option lists, since a different customer has its own
// SKUs and store chain. Each dropdown loads its own options list (refetching
// on dataVersion so new data shows up without a reload) and reports both the
// picked value and its display label up to the parent, since the parent
// needs the label for the filter badge. Active filter badges render inside
// this same card, below the controls.
export default function DashboardFilters({
  sku,
  onSkuChange,
  customer,
  store,
  onStoreChange,
  startDate,
  endDate,
  onDateRangeChange,
  effectiveStartDate,
  effectiveEndDate,
  defaultWeekRange,
  defaultMonthRange,
  defaultSixMonthRange,
  defaultYearRange,
  comparisonType,
  onComparisonTypeChange,
  previousStart,
  previousEnd,
  onPreviousStartChange,
  onPreviousEndChange,
  dataVersion = 0,
  activeFilters = null,
  onClearFilters,
}) {
  const [skuOptions, setSkuOptions] = useState([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuError, setSkuError] = useState(null);

  const [storeOptions, setStoreOptions] = useState([]);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState(null);

  const { draftStart, draftEnd, onStartChange, onEndChange } = useDraftDateRange(
    startDate,
    endDate,
    onDateRangeChange
  );

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;

    async function fetchOptions() {
      try {
        const params = new URLSearchParams({ customer });
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/sku-options?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load SKU options');
        if (!cancelled) {
          setSkuOptions(data.options);
          setSkuError(null);
        }
      } catch (err) {
        if (!cancelled) setSkuError(err.message);
      } finally {
        if (!cancelled) setSkuLoading(false);
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [customer, dataVersion]);

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;

    async function fetchOptions() {
      try {
        const params = new URLSearchParams({ customer });
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/store-options?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load store options');
        if (!cancelled) {
          setStoreOptions(data.options);
          setStoreError(null);
        }
      } catch (err) {
        if (!cancelled) setStoreError(err.message);
      } finally {
        if (!cancelled) setStoreLoading(false);
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [customer, dataVersion]);

  const error = skuError || storeError;

  // Quick Date Range buttons reflect whatever the dashboard's actual scope
  // currently is (including its own current-month default on first load —
  // see useDefaultDateRange), independent of Compare To — clicking these
  // sets the shared Date Range directly and never touches comparisonType,
  // so a comparison only ever turns on when the user presses Compare To
  // themselves (see usePeriodComparison's `active`).
  const quickRanges = [
    { label: 'This Week', range: defaultWeekRange },
    { label: 'This Month', range: defaultMonthRange },
    { label: 'Past 6 Months', range: defaultSixMonthRange },
    { label: 'Past Year', range: defaultYearRange },
  ];

  const hasActiveFilters =
    Boolean(activeFilters) || Boolean(comparisonType) || Boolean(previousStart || previousEnd);

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-deep-violet-blue">Filter</p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs text-deep-violet-blue hover:text-violet hover:underline"
          >
            Clear Filters
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-xs text-deep-violet-blue/70 mb-1">SKU</label>
          <select
            aria-label="SKU"
            value={sku}
            onChange={(e) => {
              const value = e.target.value;
              const productName = skuOptions.find((o) => o.sku === value)?.product_name ?? '';
              onSkuChange(value, productName);
            }}
            disabled={skuLoading}
            className="w-full px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet disabled:opacity-50"
          >
            {skuLoading ? (
              <option value="">Loading SKUs…</option>
            ) : (
              <>
                <option value="">All SKUs</option>
                {skuOptions.map((o) => (
                  <option key={o.sku} value={o.sku}>
                    {o.product_name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs text-deep-violet-blue/70 mb-1">Store</label>
          <select
            aria-label="Store"
            value={store}
            onChange={(e) => {
              const value = e.target.value;
              const storeName = storeOptions.find((o) => o.store_code === value)?.store_name ?? '';
              onStoreChange(value, storeName);
            }}
            disabled={storeLoading}
            className="w-full px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet disabled:opacity-50"
          >
            {storeLoading ? (
              <option value="">Loading stores…</option>
            ) : (
              <>
                <option value="">All Stores</option>
                {storeOptions.map((o) => (
                  <option key={o.store_code} value={o.store_code}>
                    {o.store_name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs text-deep-violet-blue/70 mb-1">Date Range</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {quickRanges.map(({ label, range }) => {
              const isActive =
                Boolean(range?.start) &&
                effectiveStartDate === range.start &&
                effectiveEndDate === range.end;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onDateRangeChange(range.start, range.end)}
                  disabled={!range?.start}
                  className={toggleButtonClass(isActive)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Start date"
              value={draftStart}
              onChange={(e) => onStartChange(e.target.value)}
              className="min-w-0 flex-1 px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet"
            />
            <span className="text-xs text-deep-violet-blue/50">to</span>
            <input
              type="date"
              aria-label="End date"
              value={draftEnd}
              onChange={(e) => onEndChange(e.target.value)}
              className="min-w-0 flex-1 px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-deep-violet-blue/70 mb-1">Compare To (vs. previous period)</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {COMPARISON_TYPES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onComparisonTypeChange(c.value)}
                className={toggleButtonClass(comparisonType === c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Previous period start"
              value={previousStart}
              onChange={(e) => {
                onPreviousStartChange(e.target.value);
                onComparisonTypeChange(null);
              }}
              className="min-w-0 flex-1 px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet"
            />
            <span className="text-xs text-deep-violet-blue/50">to</span>
            <input
              type="date"
              aria-label="Previous period end"
              value={previousEnd}
              onChange={(e) => {
                onPreviousEndChange(e.target.value);
                onComparisonTypeChange(null);
              }}
              className="min-w-0 flex-1 px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}

      {activeFilters && (
        <div className="mt-3 pt-3 border-t border-lavander flex flex-wrap gap-2">{activeFilters}</div>
      )}
    </div>
  );
}
