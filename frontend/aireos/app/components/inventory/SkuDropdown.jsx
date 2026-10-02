'use client';

import CheckboxDropdown from '@/app/components/promotions/CheckboxDropdown';

import { filterLabelClass } from './InventoryChrome';
import { checkRowClass } from './formStyles';

/**
 * SKU multi-select with an "All SKUs" option at the top, shared by the
 * Overview, By customer and Sell-in plan tabs. "All SKUs" is ticked whenever
 * nothing else is, and ticking it clears the individual choices. Ticking every
 * SKU by hand is the same as All SKUs, so it collapses back to it.
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {string[]} props.skus selected SKU codes ([] = all)
 * @param {(skus: string[]) => void} props.onChange
 */
export default function SkuDropdown({ skuOptions, skus, onChange }) {
  function toggle(sku) {
    const next = skus.includes(sku) ? skus.filter((s) => s !== sku) : [...skus, sku];
    onChange(next.length === skuOptions.length ? [] : next);
  }

  return (
    <div className="min-w-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:border-violet [&_button]:bg-white [&_button]:px-2 [&_button]:py-0 [&_button]:text-xs">
      <span className={filterLabelClass}>SKU</span>
      <CheckboxDropdown
        summary={skus.length ? `${skus.length} selected` : 'All SKUs'}
        searchable
        searchPlaceholder="Search SKUs…"
        listClassName="p-2"
      >
        {(query) => (
          <>
            {(!query || 'all skus'.includes(query.toLowerCase())) && (
              <label className={checkRowClass}>
                <input
                  type="checkbox"
                  checked={skus.length === 0}
                  onChange={() => onChange([])}
                  className="size-3.5 accent-deep-violet-blue"
                />
                <span className="min-w-0 truncate font-medium">All SKUs</span>
              </label>
            )}
            {skuOptions
              .filter((o) => `${o.product_name} ${o.sku}`.toLowerCase().includes(query.toLowerCase()))
              .map((option) => (
                <label key={option.sku} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={skus.includes(option.sku)}
                    onChange={() => toggle(option.sku)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  <span className="min-w-0 truncate">{option.product_name}</span>
                </label>
              ))}
          </>
        )}
      </CheckboxDropdown>
    </div>
  );
}
