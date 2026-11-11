'use client';

import SelectDropdown from '@/components/ui/SelectDropdown';

/**
 * One labelled dropdown in a list's filter bar. An empty value means "all".
 *
 * Uses the same shared pick-one menu as Dashboard and Inventory filters.
 *
 * @param {{
 *   label: string,
 *   value: string,
 *   allLabel: string,
 *   options: Array<{ value: string, label: string }>,
 *   onChange: (value: string) => void,
 * }} props
 */
export default function FilterSelect({ label, value, allLabel, options, onChange }) {
  return (
    <div className="grid min-w-0 gap-1 text-xs font-medium text-ink-soft">
      <span>{label}</span>
      <SelectDropdown
        value={value}
        onChange={onChange}
        options={[{ value: '', label: allLabel }, ...options]}
        placeholder={allLabel}
        ariaLabel={label}
        look="compact"
      />
    </div>
  );
}
