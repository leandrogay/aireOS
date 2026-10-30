'use client';

import { useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { inputClass } from '@/components/inventory/formStyles';
import { channelRetailerName } from '@/app/utils/mappingCustomer';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  foreignChannels,
  splitDecision,
  splitFromDecision,
  splitPreview,
  splitProblem,
  splitSources,
  suggestSplit,
  withCustomerChannels,
} from '@/app/utils/retailerSplit';
import { RULE_OPS } from '@/app/utils/transformSteps';
import { cn } from '@/lib/utils';

const smallButton = 'h-7 border-deep-violet-blue/30 bg-white px-2 text-xs text-deep-violet-blue hover:bg-cream';
const iconButton = 'rounded-md p-1 text-deep-violet-blue/50 hover:bg-cream hover:text-deep-violet-blue disabled:opacity-60';

// How many of a side's values are listed before "and n more".
const LISTED = 8;

function Values({ title, retailer, values, partial }) {
  return (
    <div className="min-w-0 rounded-md border border-lavander px-2 py-1.5">
      <p className="text-[11px] text-deep-violet-blue/70">
        {title} → <span className="font-mono">{retailer}</span> · {values.length}
        {partial ? '+' : ''}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-deep-violet-blue" title={values.join(' · ')}>
        {values.slice(0, LISTED).join(' · ') || '—'}
        {values.length > LISTED && ` · and ${values.length - LISTED} more`}
      </p>
    </div>
  );
}

/**
 * Which of the customer's retailers each row goes to. The dashboard reads a
 * customer's sales from {customer}_offline and {customer}_online, so that is
 * all the reviewer chooses: every row offline, every row online, or split --
 * rows whose store name (or code, format, any column) matches what marks the
 * file's online channel go online, the rest offline. The retailer names are
 * always the customer's; a proposal's names for another customer can be
 * switched over in one click.
 *
 * @param {{
 *   customer: object,
 *   decision: object,
 *   outputs: string[] | null,
 *   mapping: object,
 *   state: object,
 *   layout: object,
 *   onApply: (decision: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function ChannelSplit({ customer, decision, outputs, mapping, state, layout, onApply, disabled }) {
  const name = customer.customer_name;
  const sources = splitSources(mapping, state, layout);
  const current = splitFromDecision(decision);
  const [draft, setDraft] = useState(() =>
    current.mode === 'split' ? current : suggestSplit(sources) || { mode: 'split', source: '', matches: [{ op: 'contains', value: '' }] },
  );
  // Split is open for editing when the mapping splits now, or once chosen.
  const [mode, setMode] = useState(current.mode);

  const source = sources.find((item) => item.value === draft.source);
  const preview = source ? splitPreview(source.values, draft.matches) : null;
  const problem = splitProblem(draft);
  const applied = current.mode === 'split' && JSON.stringify(splitDecision(current, name)) === JSON.stringify(splitDecision(draft, name));
  const foreign = foreignChannels(outputs, name);
  const renamed = foreign.length ? withCustomerChannels(decision, name) : null;

  function choose(next) {
    setMode(next);
    if (next === 'offline' || next === 'online') onApply(splitDecision({ mode: next }, name));
  }

  function setMatch(index, changes) {
    setDraft((prev) => ({ ...prev, matches: prev.matches.map((match, i) => (i === index ? { ...match, ...changes } : match)) }));
  }

  const options = [
    { mode: 'offline', label: `Every row offline`, hint: channelRetailerName(name, 'offline') },
    { mode: 'online', label: `Every row online`, hint: channelRetailerName(name, 'online') },
    { mode: 'split', label: 'Split online and offline', hint: 'by what the file calls its online outlet' },
  ];

  return (
    <div className="rounded-md border border-lavander p-2">
      <p className="text-xs font-medium text-deep-violet-blue">Which of {retailerLabel(name)}&apos;s retailers each row goes to</p>

      {renamed && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            The mapping writes <span className="font-mono">{foreign.join(', ')}</span>, which{' '}
            {foreign.length === 1 ? 'is' : 'are'} not {retailerLabel(name)}&apos;s.
          </span>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => onApply(renamed)} className={cn(smallButton, 'ml-auto')}>
            Use {retailerLabel(name)}&apos;s retailers
          </Button>
        </div>
      )}

      <div role="radiogroup" aria-label="How rows are split between the retailers" className="mt-1.5 grid gap-1 sm:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.mode}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs text-deep-violet-blue',
              mode === option.mode ? 'border-deep-violet-blue bg-lavander/40' : 'border-lavander hover:bg-cream/60',
            )}
          >
            <input
              type="radio"
              name="channel-split"
              checked={mode === option.mode}
              disabled={disabled}
              onChange={() => choose(option.mode)}
              className="mt-0.5 size-3.5 accent-deep-violet-blue"
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block font-mono text-[11px] text-deep-violet-blue/60">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'custom' && (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">
          The mapping sets the retailer its own way, shown below. Choose one of these to replace it.
        </p>
      )}

      {mode === 'split' && (
        <div className="mt-2 space-y-1.5 text-xs text-deep-violet-blue">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Look at</span>
            <div className="min-w-48 flex-1">
              <SelectDropdown
                value={draft.source}
                onChange={(value) => setDraft((prev) => ({ ...prev, source: value }))}
                size="sm"
                searchable={sources.length > 8}
                placeholder="Choose a field or column…"
                ariaLabel="Where the online channel is named"
                disabled={disabled}
                options={sources.map((item) => ({ value: item.value, label: item.label, hint: item.values.slice(0, 3).join(', ') }))}
              />
            </div>
          </div>

          <ul className="space-y-1">
            {draft.matches.map((match, index) => (
              <li key={index} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0">{index === 0 ? 'Online when it' : 'or'}</span>
                <div className="w-36">
                  <SelectDropdown
                    value={match.op}
                    onChange={(op) => setMatch(index, { op })}
                    size="sm"
                    ariaLabel={`How match ${index + 1} compares`}
                    disabled={disabled}
                    options={RULE_OPS}
                  />
                </div>
                <input
                  type="text"
                  value={match.value}
                  placeholder="e.g. ONLINE"
                  aria-label={`What marks a row online (${index + 1})`}
                  disabled={disabled}
                  onChange={(event) => setMatch(index, { value: event.target.value })}
                  className={cn(inputClass, 'w-40 py-1 font-mono text-xs')}
                />
                {draft.matches.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove match ${index + 1}`}
                    disabled={disabled}
                    onClick={() => setDraft((prev) => ({ ...prev, matches: prev.matches.filter((_, i) => i !== index) }))}
                    className={iconButton}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft((prev) => ({ ...prev, matches: [...prev.matches, { op: 'contains', value: '' }] }))}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-deep-violet-blue/70 hover:bg-cream"
          >
            <Plus aria-hidden="true" className="size-3" />
            Another way it is named
          </button>
          <p className="text-[11px] text-deep-violet-blue/60">Capital letters do not matter. Everything else goes offline.</p>

          {preview && (
            <div className="grid gap-1 sm:grid-cols-2">
              <Values title="Online" retailer={channelRetailerName(name, 'online')} values={preview.online} partial={source.partial} />
              <Values title="Offline" retailer={channelRetailerName(name, 'offline')} values={preview.offline} partial={source.partial} />
            </div>
          )}
          {source?.partial && (
            <p className="text-[11px] text-deep-violet-blue/60">Some of its values. Testing the mapping checks every row.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || Boolean(problem) || applied}
              onClick={() => onApply(splitDecision(draft, name))}
              className={smallButton}
            >
              {applied ? 'Using this split' : 'Use this split'}
            </Button>
            {problem && <span className="text-[11px] text-amber-900">{problem}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
