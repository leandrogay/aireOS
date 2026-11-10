'use client';

import SelectDropdown from '@/components/ui/SelectDropdown';
import ToggleButton from '@/components/ui/ToggleButton';

import MonthFilter from './MonthFilter';
import SkuDropdown from './SkuDropdown';
import { filterLabelClass, InventoryFilterCard } from './InventoryChrome';

/**
 * SKU multi-select and month range shared by the Stock tab and the customer
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
 * @param {string} [props.defaultStart] 'YYYY-MM' the From picker opens on. Clear stays off while this and defaultEnd match
 * @param {string} [props.dataStart] 'YYYY-MM' the first month with data; earlier months are faded
 * @param {string} [props.defaultEnd] 'YYYY-MM' the To picker opens on; later months are faded
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
  dataStart = '',
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
        dataStart={dataStart}
        dataEnd={defaultEnd}
        onChange={onStartMonthChange}
      />

      <MonthFilter
        label="To"
        value={endMonth}
        min={startMonth}
        dataStart={dataStart}
        dataEnd={defaultEnd}
        onChange={onEndMonthChange}
      />

      {statusOptions && (
        <div className="min-w-0">
          <span className={filterLabelClass}>DOH status</span>
          <SelectDropdown
            value={status}
            onChange={onStatusChange}
            options={[{ value: '', label: 'All' }, ...statusOptions]}
            ariaLabel="DOH status"
            look="compact"
          />
        </div>
      )}

      {onAtRiskChange && (
        <div>
          <span className={filterLabelClass}>At risk</span>
          <ToggleButton pressed={atRiskOnly} onChange={onAtRiskChange}>
            At risk only
          </ToggleButton>
        </div>
      )}
    </InventoryFilterCard>
  );
}
