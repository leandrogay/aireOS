'use client';

import MonthDropdown from '@/components/ui/MonthDropdown';

import { filterLabelClass } from './InventoryChrome';

/**
 * One end of the inventory month range: ui/MonthDropdown in the compact
 * filter look, with a label, matching SkuDropdown beside it.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value 'YYYY-MM' or ''
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.min] 'YYYY-MM' or ''
 * @param {string} [props.max] 'YYYY-MM' or ''
 * @param {string} [props.dataStart] 'YYYY-MM' or ''
 * @param {string} [props.dataEnd] 'YYYY-MM' or ''
 */
export default function MonthFilter({ label, value, onChange, min, max, dataStart, dataEnd }) {
  return (
    <div className="min-w-0">
      <span className={filterLabelClass}>{label}</span>
      <MonthDropdown
        look="compact"
        ariaLabel={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        dataStart={dataStart}
        dataEnd={dataEnd}
        placeholder="Any month"
      />
    </div>
  );
}
