'use client';

import { Button } from '@/components/ui/button';
import FilterSelect from '@/components/ui/FilterSelect';
import { retailerLabel } from '@/app/utils/retailerLabel';

/**
 * Customer, SKU and Mechanic filters for the Uplift by mechanic table, laid
 * out like the SKU catalogue's filters (SkuFilters) but inside the table's own
 * card. A SKU on its own lists that SKU's value for every customer; a
 * mechanic on its own lists every value saved for it.
 *
 * @param {{
 *   filters: { customer: string, sku: string, mechanic: string },
 *   customers: string[],
 *   skuOptions: Array<{ value: string, label: string }>,
 *   mechanicOptions: Array<{ value: string, label: string }>,
 *   onChange: (key: 'customer' | 'sku' | 'mechanic', value: string) => void,
 *   onReset: () => void,
 * }} props
 */
export default function PromoUpliftFilters({ filters, customers, skuOptions, mechanicOptions, onChange, onReset }) {
  const hasFilters = Boolean(filters.customer || filters.sku || filters.mechanic);

  return (
    <div aria-label="Filter uplift values" role="group" className="mb-3 flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <FilterSelect
          label="Customer"
          value={filters.customer}
          allLabel="All customers"
          options={customers.map((name) => ({ value: name, label: retailerLabel(name) }))}
          onChange={(value) => onChange('customer', value)}
        />
        <FilterSelect
          label="SKU"
          value={filters.sku}
          allLabel="All SKUs"
          options={skuOptions}
          onChange={(value) => onChange('sku', value)}
        />
        <FilterSelect
          label="Mechanic"
          value={filters.mechanic}
          allLabel="All mechanics"
          options={mechanicOptions}
          onChange={(value) => onChange('mechanic', value)}
        />
      </div>
      <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>Reset</Button>
    </div>
  );
}
