'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import SelectDropdown from '@/components/ui/SelectDropdown';

// "Filter" side panel for the sales dashboard: Customer, SKU and Store. The
// Period and Compare to controls live above the trend chart instead
// (DateRangeControl, CompareControl), since the timeframe is the first thing
// to read before the numbers; Clear Filters still resets them
// (`hasPeriodChanges`). `customerControl` (a CustomerSelector owned by
// page.js) renders first because it is the master scope: `customer` scopes
// both dropdowns' own option lists, since a different customer has its own
// SKUs and store chain. The Store list is also scoped to `mode`, the channel
// the chart shows: a store is sold through one channel (an online outlet such
// as Sheng Siong's "6M_Ecomm" is the online retailer's), so the offline view
// lists only offline stores (see backend get_store_options). Each dropdown loads its own options list (refetching
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
  mode = 'offline',
  store,
  onStoreChange,
  storeDisabled = false,
  hasPeriodChanges = false,
  customersFiltered = false,
  dataVersion = 0,
  activeFilters = null,
  onClearFilters,
}) {
  // Each result remembers what it was fetched for, so a list is "loading"
  // (derived during render) until the current scope's options arrive —
  // switching customer (or, for stores, channel) never shows the previous
  // one's SKUs or stores. dataVersion refetches for the same scope stay silent.
  const [skuResult, setSkuResult] = useState({ scope: '', options: [], error: null });
  const [storeResult, setStoreResult] = useState({ scope: '', options: [], error: null });
  const skuScope = customers.join('\0');
  const skuOptions = customers.length === 0 ? [] : skuResult.options;
  const skuLoading = customers.length > 0 && skuResult.scope !== skuScope;
  const storeScope = `${customer}\0${mode}`;
  const storeOptions = customer ? storeResult.options : [];
  const storeLoading = Boolean(customer) && storeResult.scope !== storeScope;

  useEffect(() => {
    if (skuScope === '') return undefined;

    let cancelled = false;
    // Read the names back from skuScope: the page builds `customers` fresh
    // each render, so depending on the array itself refetched after every
    // response, forever.
    const scopeCustomers = skuScope.split('\0');

    async function fetchOptions() {
      try {
        const lists = await Promise.all(scopeCustomers.map(async (name) => {
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
  }, [skuScope, dataVersion]);

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;

    async function fetchOptions() {
      try {
        const params = new URLSearchParams({ customer, mode });
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/store-options?${params.toString()}`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load store options');
        if (!cancelled) setStoreResult({ scope: `${customer}\0${mode}`, options: data.options, error: null });
      } catch (err) {
        if (!cancelled) setStoreResult({ scope: `${customer}\0${mode}`, options: [], error: err.message });
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [customer, mode, dataVersion]);

  const error = skuResult.error || storeResult.error;

  const hasActiveFilters = Boolean(activeFilters) || hasPeriodChanges || customersFiltered;

  return (
    <div className="aire-card p-4 h-full">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-serif text-base text-deep-violet-blue">Filter</h3>
        <Button type="button" variant="outline" size="xs" onClick={onClearFilters} disabled={!hasActiveFilters}>
          Clear
        </Button>
      </div>

      <div className="space-y-2">
        {customerControl}

        <div>
          <label className="block text-xs text-ink-soft mb-1">SKU</label>
          {/* One SKU at a time (the API takes a single `sku`), so SelectDropdown,
              in the same compact look as the multi-select Customer above. */}
          <SelectDropdown
            ariaLabel="SKU"
            look="compact"
            searchable
            value={sku}
            onChange={(value) => {
              const productName = skuOptions.find((o) => o.sku === value)?.product_name ?? '';
              onSkuChange(value, productName);
            }}
            options={skuLoading ? [] : [
              { value: '', label: 'All SKUs' },
              ...skuOptions.map((o) => ({ value: o.sku, label: o.product_name })),
            ]}
            placeholder={skuLoading ? 'Loading SKUs…' : 'All SKUs'}
            disabled={skuLoading}
          />
        </div>

        <div>
          <label className="block text-xs text-ink-soft mb-1">Store</label>
          {/* The wrapper carries the tooltip: a disabled button gets no hover. */}
          <div title={storeDisabled ? 'Store applies when one customer is selected' : undefined}>
            <SelectDropdown
              ariaLabel="Store"
              look="compact"
              searchable
              value={store}
              onChange={(value) => {
                const storeName = storeOptions.find((o) => o.store_code === value)?.store_name ?? '';
                onStoreChange(value, storeName);
              }}
              options={storeLoading ? [] : [
                { value: '', label: 'All Stores' },
                ...storeOptions.map((o) => ({ value: o.store_code, label: o.store_name })),
              ]}
              placeholder={storeLoading ? 'Loading stores…' : 'All Stores'}
              disabled={storeDisabled || storeLoading}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-700 text-xs mt-2">{error}</p>}

      {activeFilters && (
        <div className="mt-3 pt-3 border-t border-lavander flex flex-wrap gap-2">{activeFilters}</div>
      )}
    </div>
  );
}
