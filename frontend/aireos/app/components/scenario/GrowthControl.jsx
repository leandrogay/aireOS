'use client';

import { useState } from 'react';
import { TrendingUp, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { customerLabel } from '@/app/utils/retailerLabel';
import {
  MAX_UPLIFT_PCT,
  MIN_UPLIFT_PCT,
  discardBlockChanges,
  hasUnsavedChanges,
  newScenarioBlock,
  upliftLabel,
  validateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { findGrowth, growthFields, growthInYears } from '@/app/utils/scenarioGrowth';

function signedUnits(value) {
  const number = Math.round(Number(value) || 0);
  return `${number < 0 ? '−' : '+'}${Math.abs(number).toLocaleString('en-US')}`;
}

// The customer's growth for one year: a % box, Save / Discard while it has
// unsaved changes, Remove once saved.
function GrowthRow({ label, block, impact, onEdit, onSave, onRemove, inputId }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const unsaved = block ? hasUnsavedChanges(block) : false;
  const fieldError = block && unsaved ? validateScenarioBlock(block).upliftValue : null;

  async function run(action) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded border border-lavander/80 bg-white p-2">
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-xs font-semibold text-deep-violet-blue">
          {label}
        </label>
        <div className="relative w-20 shrink-0">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            step={0.5}
            min={MIN_UPLIFT_PCT}
            max={MAX_UPLIFT_PCT}
            value={block?.upliftValue ?? ''}
            placeholder="0"
            disabled={pending}
            onChange={(event) => onEdit(event.target.value === '' ? '' : Number(event.target.value))}
            className={cn(
              'h-7 w-full rounded-md border border-violet bg-white pl-2 pr-6 text-right text-xs tabular-nums text-deep-violet-blue',
              fieldError && 'border-red-400'
            )}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-deep-violet-blue/60">
            %
          </span>
        </div>
        {unsaved ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={pending || Boolean(fieldError)}
              onClick={() => run(() => onSave(block))}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onEdit(block.saved ? discardBlockChanges(block).upliftValue : '')}
            >
              Discard
            </Button>
          </>
        ) : block?.saved ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Remove growth for ${label}`}
            onClick={() => run(() => onRemove(block))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
        {impact != null ? `${signedUnits(impact)} units in view` : block ? 'Nothing in view' : 'No growth'}
      </p>
      {fieldError || error ? <p className="mt-0.5 text-[11px] text-red-700">{error ?? fieldError}</p> : null}
    </div>
  );
}

/**
 * The budget's year-on-year growth in the Breakdown tab: next year = Tier 0
 * x (1 + g), one % per customer x year in view on every SKU
 * (scenarioGrowth.js). Typing moves the Simulated line at once, like a
 * block; Save stores it as the customer's growth block for the year. With
 * All customers picked it only lists them.
 *
 * @param {{
 *   blocks: object[],
 *   customer: string,
 *   years: string[],
 *   impacts: Map<string, { deltaUnits: number }>,
 *   onChange: (update: (blocks: object[]) => object[]) => void,
 *   onSave: (block: object) => Promise<void>,
 *   onRemove: (block: object) => Promise<void>,
 * }} props blocks = growth blocks only
 */
export default function GrowthControl({ blocks, customer, years, impacts, onChange, onSave, onRemove }) {
  // A value typed for a year with no growth yet starts a draft; clearing a
  // draft drops it (0% is no growth, and the backend never stores 0).
  function edit(year, value) {
    const existing = findGrowth(blocks, customer, year);
    const changes = { upliftValue: value, decrease: Number(value) < 0 };
    if (!existing) {
      if (value === '' || Number(value) === 0) return;
      onChange((current) => [
        ...current,
        { ...newScenarioBlock({ customers: [customer] }), ...growthFields(customer, year), ...changes },
      ]);
      return;
    }
    if (!existing.saved && (value === '' || Number(value) === 0)) {
      onChange((current) => current.filter((item) => item.id !== existing.id));
      return;
    }
    onChange((current) => current.map((item) => (item.id === existing.id ? { ...item, ...changes } : item)));
  }

  let body;
  if (!years.length) {
    body = <p className="text-[11px] text-deep-violet-blue/60">No forecast months in view to grow.</p>;
  } else if (!customer) {
    body = (
      <>
        {growthInYears(blocks, years).map((block) => (
          <p key={block.id} className="flex justify-between gap-2 text-xs text-deep-violet-blue">
            <span className="min-w-0 truncate">
              {customerLabel(block.customers[0])} · {block.startMonth.slice(0, 4)}
            </span>
            <span className="font-semibold tabular-nums">{upliftLabel(block)}</span>
          </p>
        ))}
        <p className="text-[11px] text-deep-violet-blue/60">Pick a customer to set its growth.</p>
      </>
    );
  } else {
    body = (
      <>
        {years.map((year) => {
          const block = findGrowth(blocks, customer, year);
          return (
            <GrowthRow
              key={year}
              inputId={`growth-${customer}-${year}`}
              label={`${year} · every SKU`}
              block={block}
              impact={block ? impacts.get(block.id)?.deltaUnits ?? null : null}
              onEdit={(value) => edit(year, value)}
              onSave={onSave}
              onRemove={onRemove}
            />
          );
        })}
        <p className="text-[11px] leading-snug text-deep-violet-blue/60">
          Grows Tier 0 for every SKU of {customerLabel(customer)}, January to December. Tier 0 is half last year and
          half the recent 3-month average, so if sales have been rising lately some of that is in it already and the
          result may run a little high.
        </p>
      </>
    );
  }

  return (
    <section className="space-y-1.5" aria-label="Growth">
      <div className="flex items-center gap-1.5">
        <TrendingUp className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-deep-violet-blue">
          Growth{customer ? ` · ${customerLabel(customer)}` : ''}
          {years.length === 1 ? ` · ${years[0]}` : ''}
        </h3>
      </div>
      {body}
    </section>
  );
}
