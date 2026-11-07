'use client';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';

import { filterLabelClass } from './InventoryChrome';

/**
 * SKU multi-select shared by the Overview, By customer and Sell-in plan tabs:
 * ui/MultiSelectDropdown in the compact filter look. Nothing ticked means
 * all SKUs, and ticking every SKU by hand collapses back to that.
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {string[]} props.skus selected SKU codes ([] = all)
 * @param {(skus: string[]) => void} props.onChange
 */
export default function SkuDropdown({ skuOptions, skus, onChange }) {
  return (
    <div className="min-w-0">
      <span className={filterLabelClass}>SKU</span>
      {/* No max height, so every SKU is visible without scrolling the panel. */}
      <MultiSelectDropdown
        look="compact"
        ariaLabel="SKU"
        allLabel="All SKUs"
        options={skuOptions.map((option) => ({ value: option.sku, label: option.product_name, hint: option.sku }))}
        values={skus}
        onChange={onChange}
        searchable
        searchPlaceholder="Search SKUs…"
        listClassName="max-h-none"
      />
    </div>
  );
}
