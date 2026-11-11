'use client';

import FilterBar from '@/components/ui/FilterBar';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import PriceRangeFilter from '@/components/ui/PriceRangeFilter';

const options = (values) => values.map((value) => ({ value: String(value), label: String(value) }));

/**
 * Filter bar above the SKU catalog, in the shared FilterBar. Range and brand
 * take any number of values in the tick-box dropdown the nomenclature list
 * uses (nothing ticked = all); price is one min/max popover. The matching
 * rules live in utils/skuFilters.js (filterSkus).
 *
 * @param {{
 *   filters: { skuRanges: string[], brands: string[], minPrice: string, maxPrice: string },
 *   values: { sku_ranges?: string[], brands?: string[] },
 *   hasFilters: boolean,
 *   onChange: (changes: object) => void,
 *   onReset: () => void,
 * }} props
 */
export default function SkuFilters({ filters, values, hasFilters, onChange, onReset }) {
  const skuRanges = values.sku_ranges || [];
  const brands = values.brands || [];

  return (
    <FilterBar label="Filter SKUs" hasFilters={hasFilters} onReset={onReset}>
      <MultiSelectDropdown
        look="compact"
        label="SKU range"
        allLabel="All ranges"
        placeholder="No ranges yet"
        options={options(skuRanges)}
        values={filters.skuRanges}
        onChange={(picked) => onChange({ skuRanges: picked })}
        searchable={skuRanges.length > 8}
        searchPlaceholder="Search ranges…"
      />
      <MultiSelectDropdown
        look="compact"
        label="Brand"
        allLabel="All brands"
        placeholder="No brands yet"
        options={options(brands)}
        values={filters.brands}
        onChange={(picked) => onChange({ brands: picked })}
        searchable={brands.length > 8}
        searchPlaceholder="Search brands…"
      />
      <PriceRangeFilter
        look="compact"
        label="Price"
        min={filters.minPrice}
        max={filters.maxPrice}
        onChange={({ min, max }) => onChange({ minPrice: min, maxPrice: max })}
      />
    </FilterBar>
  );
}
