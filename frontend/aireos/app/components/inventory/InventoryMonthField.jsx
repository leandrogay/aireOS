'use client';

import MonthDropdown from '@/components/ui/MonthDropdown';

import { formLabelClass } from './InventoryChrome';

/** Month choice shared by create, edit, and temporary sell-in forms. */
export default function InventoryMonthField({ value, onChange }) {
  return (
    <div>
      <span className={formLabelClass}>
        Month<span className="text-red-700"> *</span>
      </span>
      <MonthDropdown value={value} onChange={onChange} ariaLabel="Month" placeholder="Select a month" />
    </div>
  );
}
