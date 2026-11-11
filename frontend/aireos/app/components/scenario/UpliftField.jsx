'use client';

import { cn } from '@/lib/utils';
import { UPLIFT_DIRECTIONS, UPLIFT_MODES, UPLIFT_PRESETS, pctLimit } from '@/app/utils/scenarioBlocks';

const labelClass = 'mb-0.5 block text-[11px] text-ink-soft';

// A row of two or more toggle buttons (Increase | Decrease, % | Units).
function Segmented({ options, value, onSelect, labelledBy }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex rounded-md border border-lavander bg-lavander/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onSelect(option.value)}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-medium',
            value === option.value ? 'bg-deep-violet-blue text-white' : 'text-ink-soft hover:bg-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The "Expected change in sales" field of the block editor: an increase or a
 * decrease (a flood, a store closing), as a % of the Current forecast
 * (slider + presets) or a number of units across the block's whole date
 * range, for when the % isn't known. The inputs take the size; the
 * direction gives the sign that is stored.
 *
 * @param {{
 *   block: object,
 *   onChange: (changes: object) => void,
 *   onModeChange: (mode: 'pct' | 'units') => void,
 *   onDirectionChange: (decrease: boolean) => void,
 *   error?: string,
 * }} props
 */
export default function UpliftField({ block, onChange, onModeChange, onDirectionChange, error }) {
  const units = block.upliftMode === 'units';
  const decrease = block.decrease;
  const sign = decrease ? '−' : '+';
  const size = Math.abs(Number(block.upliftValue) || 0);
  const presets = decrease ? UPLIFT_PRESETS.decrease : UPLIFT_PRESETS.increase;
  const setSize = (value) => onChange({ upliftValue: decrease ? -value : value });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={labelClass} id="block-uplift-label">Expected change in sales</span>
        <div className="flex gap-1.5">
          <Segmented
            options={UPLIFT_DIRECTIONS}
            value={decrease}
            onSelect={onDirectionChange}
            labelledBy="block-uplift-label"
          />
          <Segmented options={UPLIFT_MODES} value={block.upliftMode} onSelect={onModeChange} labelledBy="block-uplift-label" />
        </div>
      </div>

      {units ? (
        <>
          <div className="flex items-center gap-2">
            <input
              id="block-uplift"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={size || ''}
              placeholder="e.g. 900"
              aria-labelledby="block-uplift-label"
              onChange={(event) => setSize(Math.abs(Number(event.target.value)) || 0)}
              className="h-8 w-full rounded-md border border-violet bg-white px-2 text-xs text-deep-violet-blue"
            />
            <span className="shrink-0 text-xs text-ink-soft">
              units {decrease ? 'fewer' : 'more'} in total
            </span>
          </div>
          <p className="text-[11px] text-ink-soft">
            Spread over the block&apos;s months{block.sku ? '' : ' and SKUs'} in line with the Current forecast.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <input
              id="block-uplift"
              type="range"
              min={0}
              max={pctLimit(decrease)}
              step={1}
              value={size}
              aria-labelledby="block-uplift-label"
              onChange={(event) => setSize(Number(event.target.value))}
              className="mr-3 w-full accent-scenario"
            />
            <output
              htmlFor="block-uplift"
              className={cn('font-serif text-lg', decrease ? 'text-red-700' : 'text-scenario-ink')}
            >
              {sign}
              {size}%
            </output>
          </div>
          <div className="flex flex-wrap gap-1">
            {presets.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSize(value)}
                className="h-6 rounded-full border border-lavander bg-white px-2 text-[11px] text-deep-violet-blue hover:bg-cream"
              >
                {sign}
                {value}%
              </button>
            ))}
          </div>
        </>
      )}

      {error ? <p className="mt-0.5 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
