'use client';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';

/**
 * The SKU range field of the block and promotion editors: tick any number of
 * ranges, or none for "All SKU ranges" (stored as an empty list). An item
 * saved on one SKU before ranges says so underneath; ticking a range moves
 * it onto ranges (the editors clear its `sku`).
 *
 * @param {{
 *   id: string,
 *   label: string,
 *   values: string[],
 *   options: string[],
 *   legacySku?: string,
 *   legacyNoun: string,           'block' or 'promotion', for the note
 *   onChange: (values: string[]) => void,
 * }} props
 */
export default function SkuRangePicker({ id, label, values, options, legacySku = '', legacyNoun, onChange }) {
  const onOneSku = Boolean(legacySku) && !values.length;

  return (
    <div>
      <span id={`${id}-label`} className="mb-0.5 block text-[11px] text-deep-violet-blue/70">
        {label}
      </span>
      <MultiSelectDropdown
        ariaLabel={label}
        options={options.map((name) => ({ value: name, label: name }))}
        values={values}
        onChange={onChange}
        allLabel="All SKU ranges"
        noneMeansAll
        placeholder={onOneSku ? legacySku : 'All SKU ranges'}
        look="field"
        searchable={options.length > 8}
        searchPlaceholder="Search SKU ranges…"
        className="w-full"
      />
      {onOneSku ? (
        <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
          This older {legacyNoun} is for one SKU ({legacySku}). Tick ranges to move it onto them.
        </p>
      ) : null}
    </div>
  );
}
