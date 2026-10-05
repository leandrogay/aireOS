'use client';

import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import MonthGrid from '@/components/ui/MonthGrid';
import { singaporeToday } from '@/lib/singaporeTime';
import { formatMonthLabel, monthPeriod, yearMonthFromYmd } from '@/app/utils/promotionForm';

/**
 * Month + year picker for Monthly promotions. Picking a month reports
 * that month's first and last day as periodStart / periodEnd.
 *
 * @param {{
 *   value: string,
 *   onChange: (period: { periodStart: string, periodEnd: string }) => void,
 *   invalid?: boolean,
 * }} props value is the current periodStart (YYYY-MM-DD)
 */
export default function MonthPicker({ value, onChange, invalid = false }) {
  const selected = yearMonthFromYmd(value);

  return (
    <CheckboxDropdown
      summary={formatMonthLabel(value)}
      placeholder="Select month"
      invalid={invalid}
    >
      {(_query, close) => (
        // MonthGrid only mounts while the dropdown is open, so every time it
        // opens it starts on the selected month's year (or this year).
        <MonthGrid
          initialYear={selected?.year ?? singaporeToday().getFullYear()}
          isSelected={(year, monthIndex) => selected?.year === year && selected?.monthIndex === monthIndex}
          onPick={(year, monthIndex) => {
            onChange(monthPeriod(year, monthIndex));
            close();
          }}
        />
      )}
    </CheckboxDropdown>
  );
}
