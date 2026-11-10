'use client';

import { Button } from '@/components/ui/button';
import FilterSelect from '@/components/ui/FilterSelect';
import { customerLabel } from '@/app/utils/retailerLabel';

/**
 * Customer, SKU range and Mechanic filters for the Uplift by mechanic table,
 * laid out like the SKU catalogue's filters (SkuFilters) but inside the
 * table's own card. Uplifts and anchors follow SKU ranges, so the narrowest
 * filter is a range: a range on its own lists that range's value for every
 * customer; a mechanic on its own lists every value saved for it.
 *
 * @param {{
 *   filters: { customer: string, skuRange: string, mechanic: string },
 *   customers: string[],
 *   skuRangeOptions: Array<{ value: string, label: string }>,
 *   mechanicOptions: Array<{ value: string, label: string }>,
 *   onChange: (key: 'customer' | 'skuRange' | 'mechanic', value: string) => void,
 *   onReset: () => void,
 * }} props
 */
export default function PromoUpliftFilters({ filters, customers, skuRangeOptions, mechanicOptions, onChange, onReset }) {
  const hasFilters = Boolean(filters.customer || filters.skuRange || filters.mechanic);

  return (
    <div aria-label="Filter uplift values" role="group" className="mb-3 flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <FilterSelect
          label="Customer"
          value={filters.customer}
          allLabel="All customers"
          options={customers.map((name) => ({ value: name, label: customerLabel(name) }))}
          onChange={(value) => onChange('customer', value)}
        />
        <FilterSelect
          label="SKU range"
          value={filters.skuRange}
          allLabel="All SKU ranges"
          options={skuRangeOptions}
          onChange={(value) => onChange('skuRange', value)}
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
