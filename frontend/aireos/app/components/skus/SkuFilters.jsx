'use client';

import { Button } from '@/components/ui/button';
import FilterSelect from '@/components/ui/FilterSelect';

const options = (values) => values.map((value) => ({ value: String(value), label: String(value) }));

// Same look as FilterSelect: a filled filter gets the solid brand border so
// active filters read the same across the whole bar.
const priceInputClass = (value) =>
  `h-9 rounded-lg border bg-white px-2.5 text-sm font-normal text-deep-violet-blue outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
    value ? 'border-deep-violet-blue' : 'border-lavander hover:bg-cream/60'
  }`;

export default function SkuFilters({ filters, values, hasFilters, onChange, onReset }) {
  return (
    <section aria-label="Filter SKUs" className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
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
              className={priceInputClass(filters.minPrice)}
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
              className={priceInputClass(filters.maxPrice)}
            />
          </label>
        </div>
        <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>Reset</Button>
      </div>
    </section>
  );
}
