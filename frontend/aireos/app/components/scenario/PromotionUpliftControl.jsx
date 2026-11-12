'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import PromotionUpliftDetails from '@/components/scenario/PromotionUpliftDetails';
import { formatPct, formatPctRange, MAX_OVERRIDE_PCT, MIN_OVERRIDE_PCT } from '@/app/utils/scenarioPromotions';

/**
 * Expected uplift and its optional override, kept together below the mechanic.
 * Opening Edit never changes the expected values; only moving the slider does.
 * @param {{ state: object, mechanic: string, rows: object[], loading: boolean,
 *   plan: string, disabled: boolean, onOverride: (value: number | null) => void }} props
 */
export default function PromotionUpliftControl({ state, mechanic, rows, loading, plan, disabled, onOverride }) {
  const [editing, setEditing] = useState(false);
  const sliderId = useId();
  const helpId = sliderId + '-help';
  const scope = plan === 'budget' ? 'budget promotion' : 'scenario promotion';
  const expectedText = state.expected.length ? formatPctRange(state.expected) : 'Unavailable';
  const usedText = state.applied.length ? formatPctRange(state.applied) : 'Unavailable';
  const markerLeft = Math.min(100, Math.max(0, ((state.reference - MIN_OVERRIDE_PCT) / (MAX_OVERRIDE_PCT - MIN_OVERRIDE_PCT)) * 100));

  function reset() {
    onOverride(null);
    setEditing(false);
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-lavander bg-cream px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-deep-violet-blue/70">Expected uplift for {mechanic || 'this mechanic'}</p>
          <p className="font-serif text-lg text-scenario-ink">{expectedText}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !state.expected.length}
          aria-expanded={editing} aria-controls={sliderId + '-editor'} onClick={() => setEditing((value) => !value)}>
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      <p className="text-[11px] text-deep-violet-blue/60">
        {plan === 'budget' ? 'Copied from Promotion uplift settings and kept with this budget promotion.'
          : rows.some((row) => row.kind === 'live') ? 'From Promotion uplift settings; saved values are used where a calculation is unavailable.'
            : 'Copied from Promotion uplift settings when this promotion was chosen.'}
        {loading && plan !== 'budget' ? ' Checking calculated values…' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={state.overridden ? 'warning' : 'muted'}>
          {state.overridden ? 'Manual override · using ' + usedText : 'Using expected uplift'}
        </StatusPill>
        {state.overridden ? (
          <Button type="button" variant="link" size="sm" onClick={reset}>Use expected uplift</Button>
        ) : null}
      </div>

      {editing ? (
        <div id={sliderId + '-editor'} className="space-y-2 border-t border-lavander pt-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-deep-violet-blue" htmlFor={sliderId}>Mechanic uplift used</label>
            <output htmlFor={sliderId} className="font-serif text-lg text-scenario">{usedText}</output>
          </div>
          <div className="relative">
            <input id={sliderId} type="range" min={MIN_OVERRIDE_PCT} max={MAX_OVERRIDE_PCT} step={0.01}
              value={state.sliderValue} disabled={disabled || !state.expected.length}
              aria-describedby={helpId} aria-valuetext={(state.overridden ? 'Manual override ' : 'Expected uplift ') + usedText}
              onChange={(event) => onOverride(Number(event.target.value))}
              className="w-full accent-scenario disabled:opacity-50" />
            <span className="pointer-events-none absolute -bottom-1 h-2 w-0.5 -translate-x-1/2 bg-deep-violet-blue/50"
              style={{ left: markerLeft + '%' }} title={'Expected uplift: ' + expectedText} aria-hidden="true" />
          </div>
          <p id={helpId} className="text-xs text-deep-violet-blue/70">
            {state.overridden ? 'Using ' + usedText + ' instead of the expected ' + expectedText + '.'
              : state.spread ? 'Each pair keeps its expected value. The slider starts at ' + formatPct(state.reference) + ', the range midpoint.'
                : 'The slider starts at the expected uplift for ' + mechanic + '.'}
            {' '}Moving it sets one override for every included customer, SKU and month in this {scope}.
          </p>
          <p className="text-[11px] text-deep-violet-blue/60">Promotion uplift settings stay unchanged.</p>
        </div>
      ) : null}

      <PromotionUpliftDetails rows={rows} overridden={state.overridden} />
    </div>
  );
}
