'use client';

import { cn } from '@/lib/utils';

import SkuDropdown from './SkuDropdown';
import { filterControlClass, filterLabelClass, InventoryFilterCard } from './InventoryChrome';

/**
 * SKU multi-select and month range shared by the overview and the customer
 * view, laid out like the sell-out forecast filter card. `statusOptions`
 * (customer view only) adds a DOH status filter, which the parent applies to
 * the rows it already has. `leading` is an extra field (the customer picker)
 * placed in the first column.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.leading]
 * @param {import('react').ReactNode} [props.stats]
 * @param {import('react').ReactNode} [props.note]
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {string[]} props.skus selected SKU codes ([] = all)
 * @param {(skus: string[]) => void} props.onSkusChange
 * @param {string} props.startMonth 'YYYY-MM' or ''
 * @param {string} props.endMonth 'YYYY-MM' or ''
 * @param {string} [props.defaultStart] 'YYYY-MM' the From picker opens on
 * @param {string} [props.defaultEnd] 'YYYY-MM' the To picker opens on; Clear stays off while both match
 * @param {(value: string) => void} props.onStartMonthChange
 * @param {(value: string) => void} props.onEndMonthChange
 * @param {string} [props.status] '' or a doh_status value
 * @param {(value: string) => void} [props.onStatusChange]
 * @param {Array<{ value: string, label: string }>} [props.statusOptions]
 * @param {boolean} [props.atRiskOnly] show only SKUs on the at-risk list
 * @param {(value: boolean) => void} [props.onAtRiskChange] adds the "At risk only" toggle
 * @param {() => void} props.onClear
 */
export default function InventoryFilters({
  leading,
  stats,
  note,
  skuOptions,
  skus,
  onSkusChange,
  startMonth,
  endMonth,
  defaultStart = '',
  defaultEnd = '',
  onStartMonthChange,
  onEndMonthChange,
  status = '',
  onStatusChange,
  statusOptions,
  atRiskOnly = false,
  onAtRiskChange,
  onClear,
}) {
  const canClear = skus.length > 0 || startMonth !== defaultStart || endMonth !== defaultEnd || Boolean(status) || atRiskOnly;

  return (
    <InventoryFilterCard canClear={canClear} onClear={onClear} stats={stats} note={note}>
      {leading}

      <SkuDropdown skuOptions={skuOptions} skus={skus} onChange={onSkusChange} />

      <label htmlFor="inventory-from-month">
        <span className={filterLabelClass}>From</span>
        <input
          id="inventory-from-month"
          type="month"
          value={startMonth}
          max={endMonth || undefined}
          onChange={(e) => onStartMonthChange(e.target.value)}
          className={filterControlClass}
        />
      </label>

      <label htmlFor="inventory-to-month">
        <span className={filterLabelClass}>To</span>
        <input
          id="inventory-to-month"
          type="month"
          value={endMonth}
          min={startMonth || undefined}
          onChange={(e) => onEndMonthChange(e.target.value)}
          className={filterControlClass}
        />
      </label>

      {statusOptions && (
        <label htmlFor="inventory-doh-status">
          <span className={filterLabelClass}>DOH status</span>
          <select
            id="inventory-doh-status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className={filterControlClass}
          >
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
        <div>
          <span className={filterLabelClass}>At risk</span>
          <button
            type="button"
            aria-pressed={atRiskOnly}
            onClick={() => onAtRiskChange(!atRiskOnly)}
            className={cn(
              'h-8 w-full rounded-md border px-2 text-center text-xs font-medium shadow-sm transition',
              atRiskOnly
                ? 'border-deep-violet-blue bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90'
                : 'border-deep-violet-blue/40 bg-white text-deep-violet-blue hover:bg-cream',
            )}
          >
            At risk only
          </button>
        </div>
      )}
    </InventoryFilterCard>
  );
}
