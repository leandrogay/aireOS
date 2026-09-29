'use client';

import { useEffect, useState } from 'react';

// "Filter" side panel for the sales dashboard: SKU and Store. The Period and
// Compare to controls live above the trend chart instead (DateRangeControl,
// CompareControl), since the timeframe is the first thing to read before
// the numbers; Clear Filters still resets them (`hasPeriodChanges`).
// `customer` (the page-header retailer-family selector) scopes both
// dropdowns' own option lists, since a different customer has its own SKUs
// and store chain. Each dropdown loads its own options list (refetching on
// dataVersion so new data shows up without a reload) and reports both the
// picked value and its display label up to the parent, since the parent
// needs the label for the filter badge. Active filter badges render inside
// this same card, below the controls.
export default function DashboardFilters({
  sku,
  onSkuChange,
  customer,
  store,
  onStoreChange,
  hasPeriodChanges = false,
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

  const hasActiveFilters = Boolean(activeFilters) || hasPeriodChanges;

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
      </div>

      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}

      {activeFilters && (
        <div className="mt-3 pt-3 border-t border-lavander flex flex-wrap gap-2">{activeFilters}</div>
      )}
    </div>
  );
}
