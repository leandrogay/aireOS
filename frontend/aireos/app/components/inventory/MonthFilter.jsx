'use client';

import MonthDropdown from '@/components/ui/MonthDropdown';

import { filterLabelClass } from './InventoryChrome';

/**
 * One end of the inventory month range: ui/MonthDropdown with the compact
 * white/violet filter look and a label, matching SkuDropdown beside it.
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
    <div className="min-w-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:border-violet [&_button]:bg-white [&_button]:px-2 [&_button]:py-0 [&_button]:text-xs">
      <span className={filterLabelClass}>{label}</span>
      {/* The panel is portalled, so the [&_button] overrides above only reach the trigger. */}
      <MonthDropdown
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
