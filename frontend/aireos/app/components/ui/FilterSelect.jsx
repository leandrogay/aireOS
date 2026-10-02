'use client';

import { ChevronDown } from 'lucide-react';

/**
 * One labelled dropdown in a list's filter bar. An empty value means "all",
 * and a picked value gets the darker border so active filters stand out.
 *
 * A native select keeps keyboard, screen reader and mobile behaviour for free;
 * the chevron is drawn over it because appearance-none removes the built-in one.
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
    <label className="grid min-w-0 gap-1 text-xs font-medium text-deep-violet-blue/70">
      {label}
      <span className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 w-full appearance-none truncate rounded-lg border bg-white pl-2.5 pr-8 text-sm font-normal outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
            value
              ? 'border-deep-violet-blue text-deep-violet-blue'
              : 'border-lavander text-deep-violet-blue/70 hover:bg-cream/60'
          }`}
        >
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-deep-violet-blue/50"
        />
      </span>
    </label>
  );
}
