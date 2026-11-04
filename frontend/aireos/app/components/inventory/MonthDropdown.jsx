'use client';

import CheckboxDropdown from '@/app/components/promotions/CheckboxDropdown';
import MonthGrid from '@/components/ui/MonthGrid';
import { singaporeToday } from '@/lib/singaporeTime';
import { formatMonth, monthValue } from '@/app/utils/inventoryForm';

import { filterLabelClass } from './InventoryChrome';

/**
 * One end of the inventory month range: a dropdown holding ui/MonthGrid, like
 * Promotions' MonthPicker but on 'YYYY-MM' values. `min`/`max` keep From
 * before To; months outside the loaded data (`dataStart`–`dataEnd`) are
 * faded but still pickable.
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
export default function MonthDropdown({ label, value, onChange, min = '', max = '', dataStart = '', dataEnd = '' }) {
  return (
    <div className="min-w-0 [&_button]:h-8 [&_button]:rounded-md [&_button]:border-violet [&_button]:bg-white [&_button]:px-2 [&_button]:py-0 [&_button]:text-xs">
      <span className={filterLabelClass}>{label}</span>
      <CheckboxDropdown summary={value ? formatMonth(value) : ''} placeholder="Any month" listClassName="p-2">
        {(_query, close) => (
          // MonthGrid only mounts while the dropdown is open, so it always
          // opens on the selected month's year (or this year). The panel is
          // portalled, so the trigger's [&_button] overrides don't reach it.
          <MonthGrid
            initialYear={value ? Number(value.slice(0, 4)) : singaporeToday().getFullYear()}
            isSelected={(year, monthIndex) => monthValue(year, monthIndex) === value}
            isMuted={(year, monthIndex) => {
              const month = monthValue(year, monthIndex);
              return Boolean(dataStart && dataEnd) && (month < dataStart || month > dataEnd);
            }}
            isDisabled={(year, monthIndex) => {
              const month = monthValue(year, monthIndex);
              return (Boolean(min) && month < min) || (Boolean(max) && month > max);
            }}
            onPick={(year, monthIndex) => {
              onChange(monthValue(year, monthIndex));
              close();
            }}
          />
        )}
      </CheckboxDropdown>
    </div>
  );
}
