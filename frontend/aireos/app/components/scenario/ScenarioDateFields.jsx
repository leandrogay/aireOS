'use client';

import SelectDropdown from '@/components/ui/SelectDropdown';

/**
 * Searchable Active from / Until fields shared by the scenario editors.
 * Exact-day offers constrain each end to the other; monthly edits keep the
 * editor's existing rule that moves the other month when the range crosses.
 *
 * @param {{
 *   id: string,
 *   start: string,
 *   end: string,
 *   options: Array<{ value: string, label: string, disabled?: boolean }>,
 *   onStartChange: (value: string) => void,
 *   onEndChange: (value: string) => void,
 *   constrainRange?: boolean,
 *   invalid?: boolean,
 * }} props
 */
export default function ScenarioDateFields({
  id, start, end, options, onStartChange, onEndChange, constrainRange = false, invalid = false,
}) {
  const fields = [
    { key: 'start', label: 'Active from', value: start, onChange: onStartChange },
    { key: 'end', label: 'Until', value: end, onChange: onEndChange },
  ];

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      {fields.map((field) => (
        <div key={field.key} className="min-w-0">
          <label className="mb-0.5 block text-[11px] text-deep-violet-blue/70" htmlFor={`${id}-${field.key}`}>
            {field.label}
          </label>
          <SelectDropdown
            id={`${id}-${field.key}`}
            ariaLabel={field.label}
            value={field.value}
            onChange={field.onChange}
            options={options.map((option) => ({
              ...option,
              disabled: option.disabled || (constrainRange && (field.key === 'start'
                ? Boolean(end && option.value > end)
                : Boolean(start && option.value < start))),
            }))}
            placeholder="Choose a date…"
            look="field"
            size="md"
            searchable
            searchPlaceholder="Search dates…"
            invalid={invalid}
          />
        </div>
      ))}
    </div>
  );
}
