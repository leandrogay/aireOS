'use client';

import SelectDropdown from '@/components/ui/SelectDropdown';
import ToggleField from '@/components/ui/ToggleField';

import MonthFilter from './MonthFilter';
import SkuDropdown from './SkuDropdown';
import { filterLabelClass, InventoryFilterCard } from './InventoryChrome';

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
 * @param {(value: boolean) => void} [props.onAtRiskChange] adds the "Only at-risk SKUs" switch,
 * @param {number | null} [props.atRiskCount] SKUs at risk for the current SKU filter, shown under
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
  atRiskCount = null,
  onClear,
}) {
  const canClear = skus.length > 0 || startMonth !== defaultStart || endMonth !== defaultEnd || Boolean(status) || atRiskOnly;

  // Nothing to show: disabled rather than hidden, so the row doesn't reflow as
  // filters change. Turning it off stays possible.
  const noneAtRisk = atRiskCount === 0 && !atRiskOnly;
  const atRiskHint = atRiskCount == null
    ? undefined
    : noneAtRisk
      ? 'None at risk right now'
      : `${atRiskCount} SKU${atRiskCount === 1 ? '' : 's'} at risk now`;
  const atRiskSwitch = onAtRiskChange && (
    <ToggleField
      label="Only at-risk SKUs"
      checked={atRiskOnly}
      onChange={onAtRiskChange}
      disabled={noneAtRisk}
      onHint={atRiskHint}
      offHint={atRiskHint}
      className="ml-1 border-l border-lavander pl-3"
    />
  );
  const headerStats = stats || atRiskSwitch ? <>{stats}{atRiskSwitch}</> : null;

  return (
    <InventoryFilterCard canClear={canClear} onClear={onClear} stats={headerStats} note={note}>
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
    </InventoryFilterCard>
  );
}
