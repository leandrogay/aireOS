'use client';

import { useEffect, useState } from 'react';

// "Filter" side panel for the sales dashboard: Customer, SKU and Store. The
// Period and Compare to controls live above the trend chart instead
// (DateRangeControl, CompareControl), since the timeframe is the first thing
// to read before the numbers; Clear Filters still resets them
// (`hasPeriodChanges`). `customerControl` (a CustomerSelector owned by
// page.js) renders first because it is the master scope: `customer` scopes
// both dropdowns' own option lists, since a different customer has its own
// SKUs and store chain. Each dropdown loads its own options list (refetching
// on dataVersion so new data shows up without a reload) and reports both the
// picked value and its display label up to the parent, since the parent
// needs the label for the filter badge. Active filter badges render inside
// this same card, below the controls.
export default function DashboardFilters({
  customerControl = null,
  sku,
  onSkuChange,
  customers = [],
  customer,
  store,
  onStoreChange,
  storeDisabled = false,
  hasPeriodChanges = false,
  customersFiltered = false,
  dataVersion = 0,
  activeFilters = null,
  onClearFilters,
}) {
  // Each result remembers which customer it was fetched for, so a list is
  // "loading" (derived during render) until the current customer's options
  // arrive — switching customer never shows the previous customer's SKUs or
  // stores. dataVersion refetches for the same customer stay silent.
  const [skuResult, setSkuResult] = useState({ scope: '', options: [], error: null });
  const [storeResult, setStoreResult] = useState({ customer: '', options: [], error: null });
  const skuScope = customers.join('\0');
  const skuOptions = customers.length === 0 ? [] : skuResult.options;
  const skuLoading = customers.length > 0 && skuResult.scope !== skuScope;
  const storeOptions = customer ? storeResult.options : [];
  const storeLoading = Boolean(customer) && storeResult.customer !== customer;

  useEffect(() => {
    if (customers.length === 0) return undefined;

    let cancelled = false;

    async function fetchOptions() {
      try {
        const lists = await Promise.all(customers.map(async (name) => {
          const params = new URLSearchParams({ customer: name });
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/sales/sku-options?${params.toString()}`,
            { credentials: 'include' },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || 'Failed to load SKU options');
          return data.options;
        }));
        const bySku = new Map();
        for (const option of lists.flat()) {
          if (!bySku.has(option.sku)) bySku.set(option.sku, option);
        }
        if (!cancelled) setSkuResult({ scope: skuScope, options: [...bySku.values()], error: null });
      } catch (err) {
        if (!cancelled) setSkuResult({ scope: skuScope, options: [], error: err.message });
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [customers, skuScope, dataVersion]);

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;

    async function fetchOptions() {
      try {
        const params = new URLSearchParams({ customer });
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/store-options?${params.toString()}`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load store options');
        if (!cancelled) setStoreResult({ customer, options: data.options, error: null });
      } catch (err) {
        if (!cancelled) setStoreResult({ customer, options: [], error: err.message });
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [customer, dataVersion]);

  const error = skuResult.error || storeResult.error;

  const hasActiveFilters = Boolean(activeFilters) || hasPeriodChanges || customersFiltered;

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-serif text-base text-deep-violet-blue">Filter</h3>
        <button
          type="button"
          onClick={onClearFilters}
          disabled={!hasActiveFilters}
          className="rounded-md border border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="space-y-2">
        {customerControl}

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
            disabled={storeDisabled || storeLoading}
            title={storeDisabled ? 'Store applies when one customer is selected' : undefined}
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
