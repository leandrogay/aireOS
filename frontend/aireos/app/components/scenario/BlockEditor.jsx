'use client';

import { Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { primaryButtonClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import UpliftField from '@/components/scenario/UpliftField';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  BLOCK_NAME_SUGGESTIONS,
  MAX_UPLIFT_PCT,
  blockMonthOptions,
  hasUnsavedChanges,
  switchUpliftMode,
} from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

const fieldClass =
  'h-8 w-full rounded-md border border-violet bg-white px-2 text-xs text-deep-violet-blue disabled:opacity-50';
const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';
const errorClass = 'mt-0.5 text-[11px] text-red-700';

function formatUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatDollars(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function FieldError({ message }) {
  return message ? <p className={errorClass}>{message}</p> : null;
}

// The sentence under the fields: what this block does to the Simulated line.
// It always gives both the units and the % of Current, so whichever way the
// uplift was entered, the other reading is there to sanity-check it.
function ImpactNote({ block, impact }) {
  if (!block.isActive) {
    return 'Inactive: this block is not on the Simulated line. Make it active in the list to see its impact.';
  }
  if (!impact) {
    return 'Not in current chart view: show this block\'s customer, SKU and months on the chart to see its impact.';
  }
  const pctOfCurrent = impact.baseUnits ? Math.round((impact.deltaUnits / impact.baseUnits) * 100) : null;
  return (
    <>
      This block adds <b>+{formatUnits(impact.deltaUnits)} units</b> (<b>+{formatDollars(impact.deltaRevenue)}</b>)
      {pctOfCurrent == null ? '' : `, or +${pctOfCurrent}% on Current,`} to {retailerLabel(block.customer)} sell-out
      across {monthSpanLabel(impact.months)}.
    </>
  );
}

// A units figure far above what the % slider allows is likely a typo (an
// extra zero), so it's flagged, but not blocked: a new store can be big.
function unitsWarning(block, impact) {
  if (block.upliftMode !== 'units' || !impact?.baseUnits) return null;
  const pct = Math.round((impact.deltaUnits / impact.baseUnits) * 100);
  if (pct <= MAX_UPLIFT_PCT) return null;
  return `That's +${pct}% on the Current forecast for these months. Double-check the number of units.`;
}

/**
 * Editor for the selected building block. Every change shows on the chart at
 * once; Save keeps it, Discard goes back to the last save.
 *
 * @param {{
 *   block: object,
 *   onChange: (changes: object) => void,
 *   onSave: () => void,
 *   onDiscard: () => void,
 *   onDelete: () => void,
 *   errors: Record<string, string>,
 *   saving: boolean,
 *   saveError: string | null,
 *   customerOptions: string[],
 *   productOptions: string[],
 *   months: string[],
 *   impact: { deltaUnits: number, deltaRevenue: number, months: string[] } | undefined,
 * }} props
 */
export default function BlockEditor({
  block,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  errors,
  saving,
  saveError,
  customerOptions,
  productOptions,
  months,
  impact,
}) {
  const unsaved = hasUnsavedChanges(block);
  const warning = unitsWarning(block, impact);
  const monthOptions = blockMonthOptions(block, months);

  return (
    <div className="space-y-2.5 border-t border-lavander pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
        Edit selected block
      </p>

      <div>
        <label className={labelClass} htmlFor="block-name">Building block</label>
        <input
          id="block-name"
          list="block-name-suggestions"
          autoComplete="off"
          value={block.name}
          placeholder="Name it, or pick a common one"
          onChange={(event) => onChange({ name: event.target.value })}
          onFocus={(event) => event.target.select()}
          className={fieldClass}
        />
        <datalist id="block-name-suggestions">
          {BLOCK_NAME_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <FieldError message={errors.name} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="block-customer">Customer</label>
          <select
            id="block-customer"
            value={block.customer}
            onChange={(event) => onChange({ customer: event.target.value })}
            className={fieldClass}
          >
            {customerOptions.map((name) => (
              <option key={name} value={name}>{retailerLabel(name)}</option>
            ))}
          </select>
          <FieldError message={errors.customer} />
        </div>
        <div>
          <label className={labelClass} htmlFor="block-sku">SKU</label>
          <select
            id="block-sku"
            value={block.sku}
            onChange={(event) => onChange({ sku: event.target.value })}
            className={fieldClass}
          >
            <option value="">All SKUs</option>
            {productOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <UpliftField
        block={block}
        onChange={onChange}
        onModeChange={(mode) => onChange(switchUpliftMode(block, mode, impact))}
        error={errors.upliftValue}
      />

      <div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="block-start">From</label>
            <select
              id="block-start"
              value={block.startMonth}
              onChange={(event) => onChange({ startMonth: event.target.value })}
              className={fieldClass}
            >
              {monthOptions.map(({ month, locked }) => (
                <option key={month} value={month} disabled={locked}>
                  {formatMonthLabel(month)}{locked ? ' (has actuals)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="block-end">Until</label>
            <select
              id="block-end"
              value={block.endMonth}
              onChange={(event) => onChange({ endMonth: event.target.value })}
              className={fieldClass}
            >
              {monthOptions.map(({ month, locked }) => (
                <option key={month} value={month} disabled={locked}>
                  {formatMonthLabel(month)}{locked ? ' (has actuals)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <FieldError message={errors.months} />
        <p className="mt-1 text-[11px] text-deep-violet-blue/50">
          Only forecast months can carry building blocks; months with actuals are locked.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="block-explanation">
          Explanation <span className="text-deep-violet-blue/50">(optional · shown in the blocks table)</span>
        </label>
        <textarea
          id="block-explanation"
          rows={3}
          value={block.explanation}
          placeholder="What's behind the uplift, e.g. 3 new outlets opening in Punggol."
          onChange={(event) => onChange({ explanation: event.target.value })}
          className="w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue"
        />
      </div>

      {/* Scenario colour only when the note gives simulated numbers; when
          the block is off or out of view it is information, in the neutral
          style the page's other notes use. */}
      <p
        className={cn(
          'rounded-md px-2.5 py-2 text-xs',
          block.isActive && impact
            ? 'bg-scenario-soft text-scenario-ink'
            : 'border border-violet bg-lavander/50 text-deep-violet-blue'
        )}
      >
        <ImpactNote block={block} impact={impact} />
      </p>
      {warning ? (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">{warning}</p>
      ) : null}

      {saveError ? <p className={errorClass}>{saveError}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={onSave} disabled={!unsaved || saving} className={cn(primaryButtonClass, 'flex-1')}>
          {saving ? 'Saving…' : unsaved ? 'Save block' : 'Saved'}
        </Button>
        {unsaved && block.saved ? (
          <Button type="button" variant="outline" onClick={onDiscard} disabled={saving} className={secondaryButtonClass}>
            Discard changes
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onDelete}
          disabled={saving}
          aria-label={`Delete ${block.name}`}
          title="Delete block"
          className="border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
