'use client';

import MonthDropdown from '@/components/ui/MonthDropdown';
import { formatMonthLabel, monthPeriod } from '@/app/utils/promotionForm';

/**
 * Month + year picker for Monthly promotions: ui/MonthDropdown reporting the
 * picked month's first and last day as periodStart / periodEnd.
 *
 * @param {{
 *   value: string,
 *   onChange: (period: { periodStart: string, periodEnd: string }) => void,
 *   invalid?: boolean,
 * }} props value is the current periodStart (YYYY-MM-DD)
 */
export default function MonthPicker({ value, onChange, invalid = false }) {
  return (
    <MonthDropdown
      look="compact"
      value={value ? value.slice(0, 7) : ''}
      summary={formatMonthLabel(value)}
      invalid={invalid}
      onChange={(month) => onChange(monthPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1))}
    />
  );
}
