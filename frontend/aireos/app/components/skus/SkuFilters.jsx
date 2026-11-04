'use client';

import FilterBar from '@/components/ui/FilterBar';
import FilterSelect from '@/components/ui/FilterSelect';
import { filterControlClass } from '@/components/ui/filterControl';

const options = (values) => values.map((value) => ({ value: String(value), label: String(value) }));

export default function SkuFilters({ filters, values, hasFilters, onChange, onReset }) {
  return (
    <FilterBar label="Filter SKUs" hasFilters={hasFilters} onReset={onReset}>
      <FilterSelect
        label="SKU range"
        value={filters.skuRange}
        allLabel="All ranges"
        options={options(values.sku_ranges || [])}
        onChange={(value) => onChange('skuRange', value)}
      />
      <FilterSelect
        label="Brand"
        value={filters.brand}
        allLabel="All brands"
        options={options(values.brands || [])}
        onChange={(value) => onChange('brand', value)}
      />
      <label className="grid gap-1 text-xs font-medium text-deep-violet-blue/70">
        Min price
        <input
          type="number"
          min="0"
          step="0.01"
          value={filters.minPrice}
          onChange={(event) => onChange('minPrice', event.target.value)}
          className={filterControlClass(Boolean(filters.minPrice))}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-deep-violet-blue/70">
        Max price
        <input
          type="number"
          min="0"
          step="0.01"
          value={filters.maxPrice}
          onChange={(event) => onChange('maxPrice', event.target.value)}
          className={filterControlClass(Boolean(filters.maxPrice))}
        />
      </label>
    </FilterBar>
  );
}
