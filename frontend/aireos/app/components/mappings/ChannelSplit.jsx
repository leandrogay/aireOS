'use client';

import { useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { Button } from '@/components/ui/button';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { inputClass } from '@/components/ui/formStyles';
import { glassInsetClass } from '@/components/ui/surfaceStyles';
import { CARD_REVEAL } from '@/app/config/transitions';
import { channelRetailerName, customerRetailerFamily } from '@/app/utils/mappingCustomer';
import { customerLabel } from '@/app/utils/retailerLabel';
import {
  fitsValueList,
  foreignChannels,
  listableSource,
  matchesForValues,
  splitDecision,
  splitFromDecision,
  splitPreview,
  splitProblem,
  splitSources,
  suggestSplit,
  suggestedMatches,
  valueChannels,
  withCustomerChannels,
} from '@/app/utils/retailerSplit';
import { RULE_OPS } from '@/app/utils/transformSteps';
import { cn } from '@/lib/utils';

import ChannelValueList from './ChannelValueList';

const smallButton = 'h-7 border-deep-violet-blue/30 bg-white px-2 text-xs text-deep-violet-blue hover:bg-lavander/50';
const iconButton = 'rounded-md p-1 text-deep-violet-blue/50 hover:bg-lavander/50 hover:text-deep-violet-blue disabled:opacity-60';
const linkButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-deep-violet-blue/70 hover:bg-lavander/50 disabled:opacity-60';

// How many of a side's values are listed before "and n more".
const LISTED = 8;

const EMPTY_SPLIT = { mode: 'split', source: '', matches: [] };

function Values({ title, values, partial }) {
  return (
    <div className={cn(glassInsetClass, 'min-w-0 px-2 py-1.5')}>
      <p className="text-[11px] text-deep-violet-blue/70">
        {title} · {values.length}
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
 * The retailer of each row. The dashboard reads a customer's sales from
 * {customer}_offline and {customer}_online, so that is all the reviewer
 * chooses: every row offline, every row online, or by a column -- each of its
 * values marked Online or Offline, or, for a column with too many values to
 * list, a pattern ("contains online"). Anything not marked online goes
 * offline, new values in later files included. Every change applies at once,
 * like the rest of the review. The retailer names are always the customer's;
 * a proposal's names for another customer can be switched over in one click.
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
  // The retailers are named after the customer's existing ones, not its
  // display name, so a renamed customer still writes where its sales are.
  const name = customerRetailerFamily(customer);
  const sources = splitSources(mapping, state, layout);
  const current = splitFromDecision(decision);
  const reduceMotion = useReducedMotion();
  // Where the editor starts from: what the mapping does now, else a suggestion.
  const startDraft = current.mode === 'split' ? current : suggestSplit(sources) || EMPTY_SPLIT;
  const startSource = sources.find((item) => item.value === startDraft.source);
  // A split that a list of values cannot show stays a pattern until the
  // reviewer turns it into one.
  const startByPattern = listableSource(startSource) && !fitsValueList(startSource, startDraft.matches);

  const [draft, setDraft] = useState(startDraft);
  // Split is open for editing when the mapping splits now, or once chosen.
  const [mode, setMode] = useState(current.mode);
  const [byPattern, setByPattern] = useState(startByPattern);
  // The parent used to remount this on every change of the decision (a `key`),
  // which cut short any animation of the split panel closing. It now starts
  // again from the mapping during render instead, when the decision or the
  // customer changes -- the one-time "adjust state during render" case.
  const decisionKey = `${customer.customer_id}:${JSON.stringify(decision.transforms)}:${decision.value ?? ''}:${decision.kind}`;
  const [syncedTo, setSyncedTo] = useState(decisionKey);
  if (syncedTo !== decisionKey) {
    setSyncedTo(decisionKey);
    setDraft(startDraft);
    setMode(current.mode);
    setByPattern(startByPattern);
  }

  const source = sources.find((item) => item.value === draft.source);
  const showList = listableSource(source) && !byPattern;
  const problem = splitProblem(draft);
  const foreign = foreignChannels(outputs, name);
  const renamed = foreign.length ? withCustomerChannels(decision, name) : null;

  // Applies a split as soon as it says something whole. The mapping's own
  // decision is what the rest of the review (and approval) reads, so nothing
  // waits on a separate "use this" step.
  function commit(next) {
    if (splitProblem(next)) return;
    const nextDecision = splitDecision(next, name);
    if (current.mode === 'split' && JSON.stringify(splitDecision(current, name)) === JSON.stringify(nextDecision)) return;
    onApply(nextDecision);
  }

  function update(next) {
    setDraft(next);
    commit(next);
  }

  function choose(next) {
    setMode(next);
    if (next === 'offline' || next === 'online') onApply(splitDecision({ mode: next }, name));
    else commit(draft);
  }

  function chooseSource(value) {
    const next = sources.find((item) => item.value === value);
    // A list starts again from the new column's own values; a pattern may
    // still hold for it ("contains online"), so it is kept.
    const matches = next && listableSource(next) && !byPattern ? suggestedMatches(next) : draft.matches;
    update({ ...draft, source: value, matches });
  }

  function setValueChannel(value, channel) {
    const online = valueChannels(source.values, draft.matches)
      .filter((row) => (row.value === value ? channel === 'online' : row.channel === 'online'))
      .map((row) => row.value);
    update({ ...draft, matches: matchesForValues(online) });
  }

  function useValueList() {
    setByPattern(false);
    update({ ...draft, matches: matchesForValues(splitPreview(source.values, draft.matches).online) });
  }

  function withMatch(index, changes) {
    return { ...draft, matches: draft.matches.map((match, i) => (i === index ? { ...match, ...changes } : match)) };
  }

  const options = [
    // The split comes first: it is the usual choice, and its column panel opens right under it.
    { mode: 'split', label: 'Varies by row', hint: 'Some rows online, some offline' },
    { mode: 'offline', label: 'All offline', hint: 'Every row is a physical store' },
    { mode: 'online', label: 'All online', hint: 'Every row is e-commerce' },
  ];
  const preview = source && !showList ? splitPreview(source.values, draft.matches) : null;

  return (
    <div>
      <div className="space-y-3">
        {renamed && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              The nomenclature writes <span className="font-mono">{foreign.join(', ')}</span>, which{' '}
              {foreign.length === 1 ? 'is' : 'are'} not {customerLabel(customer.customer_name)}&apos;s.
            </span>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => onApply(renamed)} className={cn(smallButton, 'ml-auto')}>
              Use {customerLabel(customer.customer_name)}&apos;s retailers
            </Button>
          </div>
        )}

        <div role="radiogroup" aria-label="Retailer of each row" className="grid gap-2 sm:grid-cols-3">
          {options.map((option) => (
            <label
              key={option.mode}
              title={option.mode === 'split' ? undefined : `Written to ${channelRetailerName(name, option.mode)}`}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs text-deep-violet-blue transition-colors duration-(--motion-control)',
                // Unchosen options are frosted panes with a clear edge; the
                // chosen one is tinted and outlined in ink.
                mode === option.mode
                  ? 'border-deep-violet-blue bg-lavander/60 ring-1 ring-deep-violet-blue'
                  : 'border-deep-violet-blue/15 bg-white/40 hover:bg-white/70',
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
                <span className="block text-[11px] text-deep-violet-blue/60">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === 'custom' && (
          <p className="text-[11px] text-deep-violet-blue/60">
            The nomenclature sets the retailer its own way, shown below. Choose one of these to replace it.
          </p>
        )}
      </div>

      {/* Opens and shuts with the "Varies by row" choice: the panel grows to
          its height (what is below slides with it) and its contents rise on
          the page spring, as the retailer options do (CARD_REVEAL). The gap
          above it is inside, so it grows with it instead of jumping. */}
      <AnimatePresence initial={false}>
        {mode === 'split' && (
          <motion.div
            key="split-panel"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={CARD_REVEAL.expand}
            className="-mx-1 overflow-hidden px-1 pb-1"
          >
            <motion.div
              initial={reduceMotion ? false : { y: CARD_REVEAL.y }}
              animate={{ y: 0 }}
              transition={CARD_REVEAL.transition}
              className="pt-3"
            >
              <div className={cn(glassInsetClass, 'space-y-1.5 p-3 text-xs text-deep-violet-blue')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>Column</span>
                  <div className="min-w-48 flex-1">
                    <SelectDropdown
                      value={draft.source}
                      onChange={chooseSource}
                      size="sm"
                      searchable={sources.length > 8}
                      placeholder="Choose a field or column…"
                      ariaLabel="The column that says which rows are online"
                      disabled={disabled}
                      options={sources.map((item) => ({ value: item.value, label: item.label, hint: item.values.slice(0, 3).join(', ') }))}
                    />
                  </div>
                </div>

                {showList && (
                  <ChannelValueList
                    rows={valueChannels(source.values, draft.matches)}
                    onChange={setValueChannel}
                    disabled={disabled}
                  />
                )}

                {source && !showList && (
                  <>
                    <ul className="space-y-1">
                      {draft.matches.map((match, index) => (
                        <li key={index} className="flex flex-wrap items-center gap-1.5">
                          <span className="w-24 shrink-0">{index === 0 ? 'Online when it' : 'or'}</span>
                          <div className="w-36">
                            <SelectDropdown
                              value={match.op}
                              onChange={(op) => update(withMatch(index, { op }))}
                              size="sm"
                              ariaLabel={`How match ${index + 1} compares`}
                              disabled={disabled}
                              options={RULE_OPS}
                            />
                          </div>
                          {/* Applied on leaving the box: applying remounts this
                              editor, which would lose the cursor mid-word. */}
                          <input
                            type="text"
                            value={match.value}
                            placeholder="e.g. ONLINE"
                            aria-label={`What marks a row online (${index + 1})`}
                            disabled={disabled}
                            onChange={(event) => setDraft(withMatch(index, { value: event.target.value }))}
                            onBlur={() => commit(draft)}
                            className={cn(inputClass, 'w-40 py-1 font-mono text-xs')}
                          />
                          {draft.matches.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove match ${index + 1}`}
                              disabled={disabled}
                              onClick={() => update({ ...draft, matches: draft.matches.filter((_, i) => i !== index) })}
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
                      onClick={() => setDraft({ ...draft, matches: [...draft.matches, { op: 'contains', value: '' }] })}
                      className={linkButton}
                    >
                      <Plus aria-hidden="true" className="size-3" />
                      {draft.matches.length ? 'Another way it is named' : 'Say what marks a row online'}
                    </button>
                    <p className="text-[11px] text-deep-violet-blue/60">Capital letters do not matter. Everything else goes offline.</p>

                    <div className="grid gap-1 sm:grid-cols-2">
                      <Values title="Online" values={preview.online} partial={source.partial} />
                      <Values title="Offline" values={preview.offline} partial={source.partial} />
                    </div>
                    {source.partial && (
                      <p className="text-[11px] text-deep-violet-blue/60">Some of its values. Testing the nomenclature checks every row.</p>
                    )}
                  </>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {problem && <span className="text-[11px] text-amber-900">{problem}</span>}
                  {showList && (
                    <button type="button" disabled={disabled} onClick={() => setByPattern(true)} className={cn(linkButton, 'ml-auto')}>
                      Match by pattern instead
                    </button>
                  )}
                  {listableSource(source) && !showList && (
                    <button type="button" disabled={disabled} onClick={useValueList} className={cn(linkButton, 'ml-auto')}>
                      Choose value by value instead
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
