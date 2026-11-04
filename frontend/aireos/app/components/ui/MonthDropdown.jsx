'use client';

import Dropdown from '@/components/ui/Dropdown';
import MonthGrid from '@/components/ui/MonthGrid';
import { singaporeToday } from '@/lib/singaporeTime';

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * @param {number} year
 * @param {number} monthIndex 0 = January
 * @returns {string} 'YYYY-MM'
 */
function monthValue(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/**
 * Pick one month in a closed-by-default dropdown (ui/Dropdown holding
 * ui/MonthGrid). The value is 'YYYY-MM'; a feature that keeps months another
 * way wraps this and converts (promotions/MonthPicker reports a month's first
 * and last day, inventory/MonthFilter adds the filter-card look and label).
 *
 * `min`/`max` stop months outside them being picked (e.g. a From that can't
 * pass its To). Months outside `dataStart`–`dataEnd` are faded but still
 * pickable, to show where data exists. The button reads "Jul 2026" unless
 * `summary` says otherwise.
 *
 * @param {object} props
 * @param {string} props.value 'YYYY-MM' or ''
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.min] 'YYYY-MM' or ''
 * @param {string} [props.max] 'YYYY-MM' or ''
 * @param {string} [props.dataStart] 'YYYY-MM' or ''
 * @param {string} [props.dataEnd] 'YYYY-MM' or ''
 * @param {string} [props.summary] text on the closed button
 * @param {string} [props.placeholder]
 * @param {boolean} [props.invalid]
 * @param {'field' | 'filter' | 'compact'} [props.look] see ui/Dropdown
 * @param {string} [props.ariaLabel]
 */
export default function MonthDropdown({
  value,
  onChange,
  min = '',
  max = '',
  dataStart = '',
  dataEnd = '',
  summary,
  placeholder = 'Select month',
  invalid = false,
  look = 'field',
  ariaLabel,
}) {
  const shownSummary = summary ?? (value ? MONTH_FORMAT.format(new Date(`${value}-01T00:00:00Z`)) : '');

  return (
    // Exactly the button's width and no scroll: the grid lays itself out to fit.
    <Dropdown
      summary={shownSummary}
      placeholder={placeholder}
      look={look}
      ariaLabel={ariaLabel}
      invalid={invalid}
      panelClassName="w-(--anchor-width)"
      listClassName="max-h-none p-2"
    >
      {(_query, close) => (
        // MonthGrid only mounts while the dropdown is open, so every time it
        // opens it starts on the selected month's year (or this year).
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
    </Dropdown>
  );
}
