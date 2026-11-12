'use client';

import { inputClass } from '@/components/ui/formStyles';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { without } from '@/app/utils/mappingReview';
import { TEXT_CASES } from '@/app/utils/transformSteps';
import { cn } from '@/lib/utils';

const smallInput = cn(inputClass, 'py-1 text-xs');
const codeInput = cn(smallInput, 'font-mono text-[11px]');
const labelText = 'block text-[11px] text-deep-violet-blue/70';

// backend value_parsing.DECIMAL_MARKS
const DECIMAL_MARKS = [
  { value: '.', label: 'Decimal point — 1,250.50' },
  { value: ',', label: 'Decimal comma — 1.250,50' },
];

function TextSetting({ label, value, onChange, disabled, code = false, type = 'text', className }) {
  return (
    <label className={labelText}>
      {label}
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(code ? codeInput : smallInput, 'mt-0.5', className)}
      />
    </label>
  );
}

function columnOptions(columns) {
  return columns.map((column) => ({ value: column, label: column }));
}

/**
 * The settings of the steps that read how a value is written or reshape its
 * text (backend mapping_contract parse_number, parse_date, scale, blank_if,
 * fill_empty, split_part, replace, normalize_text, concat). The older steps'
 * settings are in StepSettings, which hands these on.
 *
 * @param {{
 *   step: object,
 *   columns: string[],
 *   onChange: (step: object) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function ReadingStepSettings({ step, columns, onChange, disabled = false }) {
  switch (step.type) {
    case 'parse_number':
      return (
        <SelectDropdown
          value={step.decimal || '.'}
          onChange={(decimal) => onChange({ ...step, decimal })}
          size="sm"
          ariaLabel="How the decimals are written"
          disabled={disabled}
          options={DECIMAL_MARKS}
        />
      );
    case 'parse_date':
      return (
        <TextSetting
          label="How the dates are written (e.g. %d/%m/%Y, or excel_serial) — leave empty for dates like 2026-08-31"
          value={step.format}
          code
          disabled={disabled}
          onChange={(format) => onChange(format ? { ...step, format } : without(step, ['format']))}
        />
      );
    case 'scale':
      return (
        <TextSetting
          label="Multiply every value by"
          type="number"
          value={step.factor}
          disabled={disabled}
          className="w-28"
          onChange={(factor) => onChange({ ...step, factor: factor === '' ? '' : Number(factor) })}
        />
      );
    case 'blank_if':
      return (
        <TextSetting
          label="Values that mean empty, separated by commas (capitals do not matter)"
          value={(step.tokens || []).join(', ')}
          code
          disabled={disabled}
          onChange={(text) => onChange({ ...step, tokens: text.split(',').map((token) => token.trimStart()) })}
        />
      );
    case 'fill_empty':
      return (
        <div className="space-y-1.5">
          <TextSetting
            label="An empty cell becomes"
            value={step.default}
            disabled={disabled || Boolean(step.column)}
            onChange={(value) => onChange({ ...without(step, ['column']), default: value })}
          />
          <SelectDropdown
            value={step.column || ''}
            onChange={(column) => onChange(column ? { ...without(step, ['default']), column } : without(step, ['column']))}
            size="sm"
            searchable={columns.length > 8}
            placeholder="…or the value in another column"
            ariaLabel="Column an empty cell is filled from"
            disabled={disabled}
            options={[{ value: '', label: 'A fixed value' }, ...columnOptions(columns)]}
          />
        </div>
      );
    case 'split_part':
      return (
        <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <TextSetting
            label="Split at"
            value={step.separator}
            code
            disabled={disabled}
            onChange={(separator) => onChange({ ...step, separator })}
          />
          <TextSetting
            label="Part no. (-1 = last)"
            type="number"
            value={step.index}
            disabled={disabled}
            onChange={(index) => onChange({ ...step, index: Math.trunc(Number(index)) || 0 })}
          />
        </div>
      );
    case 'replace':
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <TextSetting
            label="Pattern to find (advanced)"
            value={step.pattern}
            code
            disabled={disabled}
            onChange={(pattern) => onChange({ ...step, pattern })}
          />
          <TextSetting
            label="Becomes (leave empty to remove it)"
            value={step.replacement}
            code
            disabled={disabled}
            onChange={(replacement) => onChange({ ...step, replacement })}
          />
        </div>
      );
    case 'normalize_text':
      return (
        <SelectDropdown
          value={step.case || 'keep'}
          onChange={(textCase) => onChange({ ...step, case: textCase })}
          size="sm"
          ariaLabel="Capital letters"
          disabled={disabled}
          options={TEXT_CASES}
        />
      );
    case 'concat':
      return (
        <div className="space-y-1.5">
          <MultiSelectDropdown
            ariaLabel="Columns to join on"
            options={columnOptions(columns)}
            values={step.columns || []}
            onChange={(chosen) => onChange({ ...step, columns: chosen })}
            noneMeansAll={false}
            placeholder="Choose the columns to join on…"
            searchable={columns.length > 8}
            disabled={disabled}
          />
          <TextSetting
            label="Written between the parts"
            value={step.separator}
            code
            disabled={disabled}
            className="w-28"
            onChange={(separator) => onChange({ ...step, separator })}
          />
        </div>
      );
    default:
      return null;
  }
}
