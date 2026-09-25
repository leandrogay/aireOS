'use client';

import CheckboxDropdown from '@/app/components/promotions/CheckboxDropdown';
import { Button } from '@/components/ui/button';

import { checkRowClass, inputClass, labelClass } from './formStyles';

/**
 * SKU multi-select and month range shared by the overview and the customer
 * view. `statusOptions` (customer view only) adds a DOH status filter, which
 * the parent applies to the rows it already has.
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {string[]} props.skus selected SKU codes ([] = all)
 * @param {(skus: string[]) => void} props.onSkusChange
 * @param {string} props.startMonth 'YYYY-MM' or ''
 * @param {string} props.endMonth 'YYYY-MM' or ''
 * @param {(value: string) => void} props.onStartMonthChange
 * @param {(value: string) => void} props.onEndMonthChange
 * @param {string} [props.status] '' or a doh_status value
 * @param {(value: string) => void} [props.onStatusChange]
 * @param {Array<{ value: string, label: string }>} [props.statusOptions]
 * @param {boolean} [props.atRiskOnly] show only SKUs on the at-risk list
 * @param {(value: boolean) => void} [props.onAtRiskChange] adds the "At risk only" checkbox
 * @param {() => void} props.onClear
 */
export default function InventoryFilters({
  skuOptions,
  skus,
  onSkusChange,
  startMonth,
  endMonth,
  onStartMonthChange,
  onEndMonthChange,
  status = '',
  onStatusChange,
  statusOptions,
  atRiskOnly = false,
  onAtRiskChange,
  onClear,
}) {
  const hasFilters = skus.length > 0 || startMonth || endMonth || status || atRiskOnly;

  function toggleSku(sku) {
    onSkusChange(skus.includes(sku) ? skus.filter((s) => s !== sku) : [...skus, sku]);
  }

  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div className="w-56">
        <span className={labelClass}>SKU</span>
        <CheckboxDropdown
          summary={skus.length ? `${skus.length} selected` : 'All SKUs'}
          searchable
          searchPlaceholder="Search SKUs…"
        >
          {(query) =>
            skuOptions
              .filter((o) => `${o.product_name} ${o.sku}`.toLowerCase().includes(query.toLowerCase()))
              .map((option) => (
                <label key={option.sku} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={skus.includes(option.sku)}
                    onChange={() => toggleSku(option.sku)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  <span className="min-w-0 truncate">{option.product_name}</span>
                </label>
              ))
          }
        </CheckboxDropdown>
      </div>

      <label className="w-40">
        <span className={labelClass}>From month</span>
        <input
          type="month"
          value={startMonth}
          max={endMonth || undefined}
          onChange={(e) => onStartMonthChange(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="w-40">
        <span className={labelClass}>To month</span>
        <input
          type="month"
          value={endMonth}
          min={startMonth || undefined}
          onChange={(e) => onEndMonthChange(e.target.value)}
          className={inputClass}
        />
      </label>

      {statusOptions && (
        <label className="w-40">
          <span className={labelClass}>DOH status</span>
          <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={inputClass}>
            <option value="">All</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {onAtRiskChange && (
        <label className="flex items-center gap-2 pb-1.5 text-sm text-deep-violet-blue">
          <input
            type="checkbox"
            checked={atRiskOnly}
            onChange={(e) => onAtRiskChange(e.target.checked)}
            className="size-3.5 accent-deep-violet-blue"
          />
          At risk only
        </label>
      )}

      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
