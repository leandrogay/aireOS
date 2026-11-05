'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import MonthFilter from './MonthFilter';
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
 * @param {string} [props.defaultStart] 'YYYY-MM' the From picker opens on; earlier months are faded
 * @param {string} [props.defaultEnd] 'YYYY-MM' the To picker opens on; later months are faded. Clear stays off while both match
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

      <MonthFilter
        label="From"
        value={startMonth}
        max={endMonth}
        dataStart={defaultStart}
        dataEnd={defaultEnd}
        onChange={onStartMonthChange}
      />

      <MonthFilter
        label="To"
        value={endMonth}
        min={startMonth}
        dataStart={defaultStart}
        dataEnd={defaultEnd}
        onChange={onEndMonthChange}
      />

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
          <Button
            type="button"
            variant="outline"
            aria-pressed={atRiskOnly}
            onClick={() => onAtRiskChange(!atRiskOnly)}
            className={cn(
              'h-8 w-full rounded-md px-2 text-center text-xs font-medium shadow-sm transition',
              atRiskOnly
                ? 'border-deep-violet-blue bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90 hover:text-white'
                : 'border-deep-violet-blue/40 bg-white text-deep-violet-blue hover:bg-cream hover:text-deep-violet-blue',
            )}
          >
            At risk only
          </Button>
        </div>
      )}
    </InventoryFilterCard>
  );
}
