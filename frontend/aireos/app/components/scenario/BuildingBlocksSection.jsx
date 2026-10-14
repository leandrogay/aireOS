'use client';

import { useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  BLOCK_NAME_SUGGESTIONS,
  MAX_UPLIFT_PCT,
  UPLIFT_PRESETS,
  newScenarioBlock,
  updateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

const fieldClass =
  'h-8 w-full rounded-md border border-violet bg-white px-2 text-xs text-deep-violet-blue disabled:opacity-50';
const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';

function formatUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatDollars(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function blockSummary(block) {
  const span = monthSpanLabel([block.startMonth, block.endMonth].filter(Boolean));
  return `${block.sku || 'All SKUs'} · +${block.upliftPct}% · ${span}`;
}

/**
 * Building blocks tab of the Scenario builder panel: the draft's blocks as a
 * list, and an editor for the selected one (blueprint Part 1.2).
 *
 * Impact numbers come from the engine (`impacts` = simulate().byItem), so a
 * block with no entry there sits outside the rows the page fetched and is
 * labelled instead of showing numbers (blueprint Part 4.6).
 *
 * @param {{
 *   items: object[],
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   customerOptions: string[],
 *   productOptions: string[],
 *   months: string[],
 *   defaultCustomer: string,
 *   defaultSku: string,
 *   impacts: Map<string, { deltaUnits: number, deltaRevenue: number, months: string[] }>,
 * }} props
 */
export default function BuildingBlocksSection({
  items,
  onChange,
  customerOptions,
  productOptions,
  months,
  defaultCustomer,
  defaultSku,
  impacts,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = items.find((block) => block.id === selectedId) ?? items[0] ?? null;
  const canAdd = months.length > 0 && customerOptions.length > 0;

  function addBlock() {
    const block = newScenarioBlock({
      customer: defaultCustomer || customerOptions[0] || '',
      sku: defaultSku,
      months,
    });
    onChange((current) => [...current, block]);
    setSelectedId(block.id);
  }

  function removeBlock(id) {
    onChange((current) => current.filter((block) => block.id !== id));
  }

  function updateSelected(changes) {
    onChange((current) =>
      current.map((block) => (block.id === selected.id ? updateScenarioBlock(block, changes) : block))
    );
  }

  const impact = selected ? impacts.get(selected.id) : null;

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {items.map((block) => (
          <li key={block.id} className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedId(block.id)}
              aria-pressed={block.id === selected?.id}
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2 rounded-md border px-2.5 py-2 text-left transition',
                block.id === selected?.id
                  ? 'border-scenario bg-scenario-soft'
                  : 'border-lavander bg-white hover:bg-cream/60'
              )}
            >
              <Tag className="mt-0.5 size-3.5 shrink-0 text-scenario" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-deep-violet-blue">
                  {retailerLabel(block.customer)} · {block.name}
                </span>
                <span className="block truncate text-[11px] text-deep-violet-blue/60">{blockSummary(block)}</span>
                {impacts.has(block.id) ? null : (
                  <span className="block text-[11px] italic text-deep-violet-blue/50">
                    Not in current chart view
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => removeBlock(block.id)}
              aria-label={`Remove ${block.name}`}
              className="flex size-8 shrink-0 items-center justify-center self-center rounded-md border border-lavander bg-white text-deep-violet-blue/70 hover:bg-cream"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {items.length ? null : (
        <p className="text-xs text-deep-violet-blue/60">No building blocks yet. Add one to start simulating.</p>
      )}

      <button
        type="button"
        onClick={addBlock}
        disabled={!canAdd}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-deep-violet-blue/40 text-xs font-medium text-deep-violet-blue hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        Add building block
      </button>
      {canAdd ? null : (
        <p className="text-[11px] text-deep-violet-blue/60">
          Pick a date range that includes forecast months to add building blocks.
        </p>
      )}

      {selected ? (
        <div className="space-y-2.5 border-t border-lavander pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
            Edit selected block
          </p>

          <div>
            <label className={labelClass} htmlFor="block-customer">Customer</label>
            <select
              id="block-customer"
              value={selected.customer}
              onChange={(event) => updateSelected({ customer: event.target.value })}
              className={fieldClass}
            >
              {customerOptions.map((name) => (
                <option key={name} value={name}>{retailerLabel(name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="block-sku">SKU</label>
            <select
              id="block-sku"
              value={selected.sku}
              onChange={(event) => updateSelected({ sku: event.target.value })}
              className={fieldClass}
            >
              <option value="">All SKUs</option>
              {productOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="block-name">Building block</label>
            <input
              id="block-name"
              list="block-name-suggestions"
              autoComplete="off"
              value={selected.name}
              placeholder="Name it, or pick a common one"
              onChange={(event) => updateSelected({ name: event.target.value })}
              onFocus={(event) => event.target.select()}
              className={fieldClass}
            />
            <datalist id="block-name-suggestions">
              {BLOCK_NAME_SUGGESTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={labelClass} htmlFor="block-explanation">
              Explanation <span className="text-deep-violet-blue/50">(optional · shown in the pitch summary)</span>
            </label>
            <textarea
              id="block-explanation"
              rows={3}
              value={selected.explanation}
              placeholder="Why this block, and what's behind the uplift."
              onChange={(event) => updateSelected({ explanation: event.target.value })}
              className="w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className={labelClass} htmlFor="block-uplift">Sales uplift</label>
              <output htmlFor="block-uplift" className="font-serif text-lg text-scenario">
                +{selected.upliftPct}%
              </output>
            </div>
            <input
              id="block-uplift"
              type="range"
              min={0}
              max={MAX_UPLIFT_PCT}
              step={1}
              value={selected.upliftPct}
              onChange={(event) => updateSelected({ upliftPct: Number(event.target.value) })}
              className="w-full accent-scenario"
            />
            <div className="flex flex-wrap gap-1">
              {UPLIFT_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateSelected({ upliftPct: value })}
                  className="h-6 rounded-full border border-lavander bg-white px-2 text-[11px] text-deep-violet-blue hover:bg-cream"
                >
                  +{value}%
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="block-start">Active from</label>
              <select
                id="block-start"
                value={selected.startMonth}
                onChange={(event) => updateSelected({ startMonth: event.target.value })}
                className={fieldClass}
              >
                {months.map((month) => (
                  <option key={month} value={month}>{formatMonthLabel(month)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="block-end">Until</label>
              <select
                id="block-end"
                value={selected.endMonth}
                onChange={(event) => updateSelected({ endMonth: event.target.value })}
                className={fieldClass}
              >
                {months.map((month) => (
                  <option key={month} value={month}>{formatMonthLabel(month)}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-deep-violet-blue/50">
            Only forecast months can carry building blocks; months with actuals are locked.
          </p>

          <p className="rounded-md bg-scenario-soft px-2.5 py-2 text-xs text-scenario-ink">
            {impact ? (
              <>
                This block adds <b>+{formatUnits(impact.deltaUnits)} units</b> (
                <b>+{formatDollars(impact.deltaRevenue)}</b>) to {retailerLabel(selected.customer)} sell-out across{' '}
                {monthSpanLabel(impact.months)}.
              </>
            ) : (
              'Not in current chart view: change the filters to this customer and SKU to see its impact.'
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
