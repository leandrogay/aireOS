'use client';

import { Plus, X } from 'lucide-react';

import { inputClass } from '@/components/inventory/formStyles';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { without } from '@/app/utils/mappingReview';
import { REGEX_PRESETS, RULE_OPS } from '@/app/utils/transformSteps';
import { cn } from '@/lib/utils';

const smallInput = cn(inputClass, 'py-1 text-xs');
const codeInput = cn(smallInput, 'font-mono text-[11px]');
const linkButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-deep-violet-blue/70 hover:bg-cream hover:text-deep-violet-blue disabled:opacity-60';
const iconButton =
  'rounded-md p-1 text-deep-violet-blue/50 hover:bg-cream hover:text-deep-violet-blue disabled:opacity-60';

const CUSTOM = '__custom__';

function Fallback({ step, onChange, disabled }) {
  return (
    <label className="block text-[11px] text-deep-violet-blue/70">
      Anything else becomes (leave empty to leave it blank)
      <input
        type="text"
        value={step.default ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ ...step, default: event.target.value })}
        className={cn(smallInput, 'mt-0.5')}
      />
    </label>
  );
}

function CaseSensitive({ step, onChange, disabled }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-deep-violet-blue/70">
      <input
        type="checkbox"
        checked={step.case_sensitive === true}
        disabled={disabled}
        onChange={(event) => onChange({ ...step, case_sensitive: event.target.checked })}
        className="size-3.5 accent-deep-violet-blue"
      />
      Capital letters matter
    </label>
  );
}

function PatternStep({ step, onChange, disabled }) {
  const preset = REGEX_PRESETS.find((item) => item.pattern === step.pattern);
  return (
    <div className="space-y-1.5">
      <SelectDropdown
        value={preset ? preset.pattern : CUSTOM}
        onChange={(value) => onChange({ ...step, pattern: value === CUSTOM ? step.pattern : value, group: 1 })}
        size="sm"
        ariaLabel="What to take from the text"
        disabled={disabled}
        options={[
          ...REGEX_PRESETS.map((item) => ({ value: item.pattern, label: item.label })),
          { value: CUSTOM, label: 'My own pattern…' },
        ]}
      />
      <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <label className="block text-[11px] text-deep-violet-blue/70">
          Pattern (advanced) — the part in round brackets is kept
          <input
            type="text"
            value={step.pattern || ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...step, pattern: event.target.value })}
            className={cn(codeInput, 'mt-0.5')}
          />
        </label>
        <label className="block text-[11px] text-deep-violet-blue/70">
          Bracket no.
          <input
            type="number"
            min={1}
            value={step.group || 1}
            disabled={disabled}
            onChange={(event) => onChange({ ...step, group: Math.max(1, Number(event.target.value) || 1) })}
            className={cn(smallInput, 'mt-0.5')}
          />
        </label>
      </div>
    </div>
  );
}

// The table's pairs are edited as a list so a half-typed key never collides
// with another and a row can be emptied without vanishing.
function TableStep({ step, onChange, disabled, isCodeTable }) {
  const pairs = Object.entries(step.values || {});

  function setPairs(next) {
    onChange({ ...step, values: Object.fromEntries(next) });
  }

  return (
    <div className="space-y-1.5">
      {isCodeTable && (
        <p className="text-[11px] text-deep-violet-blue/60">
          This is the product-code table. It is easier to edit under “Which of our products each code is”.
        </p>
      )}
      <ul className="space-y-1">
        {pairs.map(([from, to], index) => (
          <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1">
            <input
              type="text"
              value={from}
              placeholder="In the file"
              aria-label={`Value ${index + 1} in the file`}
              disabled={disabled}
              onChange={(event) => setPairs(pairs.map((pair, i) => (i === index ? [event.target.value, pair[1]] : pair)))}
              className={codeInput}
            />
            <span aria-hidden="true" className="text-xs text-deep-violet-blue/50">→</span>
            <input
              type="text"
              value={to}
              placeholder="Becomes"
              aria-label={`What value ${index + 1} becomes`}
              disabled={disabled}
              onChange={(event) => setPairs(pairs.map((pair, i) => (i === index ? [pair[0], event.target.value] : pair)))}
              className={codeInput}
            />
            <button
              type="button"
              aria-label={`Remove value ${index + 1}`}
              disabled={disabled}
              onClick={() => setPairs(pairs.filter((_, i) => i !== index))}
              className={iconButton}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={disabled || pairs.some(([from]) => !from)} onClick={() => setPairs([...pairs, ['', '']])} className={linkButton}>
        <Plus aria-hidden="true" className="size-3" />
        Add a value
      </button>
      <Fallback step={step} onChange={onChange} disabled={disabled} />
      <CaseSensitive step={step} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function RulesStep({ step, onChange, disabled }) {
  const rules = step.rules || [];

  function setRule(index, changes) {
    onChange({ ...step, rules: rules.map((rule, i) => (i === index ? { ...rule, ...changes } : rule)) });
  }

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1">
        {rules.map((rule, index) => (
          <li key={index} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1">
            <SelectDropdown
              value={rule.op}
              onChange={(op) => setRule(index, { op })}
              size="sm"
              ariaLabel={`How rule ${index + 1} matches`}
              disabled={disabled}
              options={RULE_OPS}
            />
            <input
              type="text"
              value={rule.value}
              placeholder="Value"
              aria-label={`What rule ${index + 1} looks for`}
              disabled={disabled}
              onChange={(event) => setRule(index, { value: event.target.value })}
              className={codeInput}
            />
            <span aria-hidden="true" className="text-xs text-deep-violet-blue/50">→</span>
            <input
              type="text"
              value={rule.output}
              placeholder="Becomes"
              aria-label={`What rule ${index + 1} writes`}
              disabled={disabled}
              onChange={(event) => setRule(index, { output: event.target.value })}
              className={codeInput}
            />
            <button
              type="button"
              aria-label={`Remove rule ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange({ ...step, rules: rules.filter((_, i) => i !== index) })}
              className={iconButton}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...step, rules: [...rules, { op: 'equals', value: '', output: '' }] })}
        className={linkButton}
      >
        <Plus aria-hidden="true" className="size-3" />
        Add a rule
      </button>
      <Fallback step={step} onChange={onChange} disabled={disabled} />
      <CaseSensitive step={step} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function ColumnChoice({ value, columns, onChange, disabled, ariaLabel, placeholder = 'Choose a column…' }) {
  return (
    <SelectDropdown
      value={value || ''}
      onChange={onChange}
      size="sm"
      searchable={columns.length > 8}
      searchPlaceholder="Search columns…"
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
      options={columns.map((column) => ({ value: column, label: column }))}
    />
  );
}

// Each unit's factor is a number, or a column of the file holding it (a
// carton's pack count, say).
function UnitStep({ step, columns, onChange, disabled }) {
  const factors = Object.entries(step.factors || {});

  function setFactors(next) {
    onChange({ ...step, factors: Object.fromEntries(next) });
  }

  return (
    <div className="space-y-1.5">
      <ColumnChoice
        value={step.column}
        columns={columns}
        onChange={(column) => onChange({ ...step, column })}
        disabled={disabled}
        ariaLabel="Column holding the unit"
        placeholder="Column holding the unit…"
      />
      <ul className="space-y-1">
        {factors.map(([unit, factor], index) => {
          const byColumn = factor && typeof factor === 'object';
          return (
            <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1">
              <input
                type="text"
                value={unit}
                placeholder="Unit, e.g. CAR"
                aria-label={`Unit ${index + 1}`}
                disabled={disabled}
                onChange={(event) => setFactors(factors.map((pair, i) => (i === index ? [event.target.value, pair[1]] : pair)))}
                className={codeInput}
              />
              <span aria-hidden="true" className="text-xs text-deep-violet-blue/50">×</span>
              {byColumn ? (
                <ColumnChoice
                  value={factor.column}
                  columns={columns}
                  onChange={(column) => setFactors(factors.map((pair, i) => (i === index ? [pair[0], { column }] : pair)))}
                  disabled={disabled}
                  ariaLabel={`Column with the factor for unit ${index + 1}`}
                />
              ) : (
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={factor}
                  aria-label={`Factor for unit ${index + 1}`}
                  disabled={disabled}
                  onChange={(event) =>
                    setFactors(factors.map((pair, i) => (i === index ? [pair[0], Number(event.target.value)] : pair)))
                  }
                  className={smallInput}
                />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => setFactors(factors.map((pair, i) => (i === index ? [pair[0], byColumn ? 1 : { column: '' }] : pair)))}
                className={cn(linkButton, 'whitespace-nowrap')}
              >
                {byColumn ? 'Use a number' : 'Use a column'}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" disabled={disabled} onClick={() => setFactors([...factors, ['', 1]])} className={linkButton}>
        <Plus aria-hidden="true" className="size-3" />
        Add a unit
      </button>
      <label className="block text-[11px] text-deep-violet-blue/70">
        Any other unit is multiplied by
        <input
          type="number"
          min={0}
          step="any"
          value={step.default ?? 1}
          disabled={disabled}
          onChange={(event) => onChange({ ...step, default: Number(event.target.value) || 1 })}
          className={cn(smallInput, 'mt-0.5 w-24')}
        />
      </label>
    </div>
  );
}

/**
 * The settings of one step, by its type: a pattern to take part of the text,
 * a table or rules to translate values, a column to multiply by, units to
 * convert. Steps with nothing to set (flip the sign, 0 means no sale…) show
 * nothing here.
 *
 * @param {{
 *   step: object,
 *   columns: string[],
 *   onChange: (step: object) => void,
 *   disabled?: boolean,
 *   isCodeTable?: boolean,
 * }} props
 */
export default function StepSettings({ step, columns, onChange, disabled = false, isCodeTable = false }) {
  switch (step.type) {
    case 'regex_extract':
      return <PatternStep step={step} onChange={onChange} disabled={disabled} />;
    case 'value_map':
      return <TableStep step={step} onChange={onChange} disabled={disabled} isCodeTable={isCodeTable} />;
    case 'rules':
      return <RulesStep step={step} onChange={onChange} disabled={disabled} />;
    case 'multiply':
      return (
        <ColumnChoice
          value={step.column}
          columns={columns}
          onChange={(column) => onChange({ ...step, column })}
          disabled={disabled}
          ariaLabel="Column to multiply by"
        />
      );
    case 'uom_factor':
      return <UnitStep step={step} columns={columns} onChange={onChange} disabled={disabled} />;
    case 'month_start':
      return (
        <label className="block text-[11px] text-deep-violet-blue/70">
          How the dates are written (advanced, e.g. %d/%m/%Y) — leave empty to read them automatically
          <input
            type="text"
            value={step.format || ''}
            disabled={disabled}
            onChange={(event) =>
              onChange(event.target.value ? { ...step, format: event.target.value } : without(step, ['format']))
            }
            className={cn(codeInput, 'mt-0.5')}
          />
        </label>
      );
    default:
      return null;
  }
}
