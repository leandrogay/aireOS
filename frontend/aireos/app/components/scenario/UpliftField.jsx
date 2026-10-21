'use client';

import { cn } from '@/lib/utils';
import { MAX_UPLIFT_PCT, UPLIFT_MODES, UPLIFT_PRESETS } from '@/app/utils/scenarioBlocks';

const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';

/**
 * The "Expected sales uplift" field of the block editor: a % of the Current
 * forecast (slider + presets), or a number of units added across the
 * block's whole date range, for when the % isn't known.
 *
 * @param {{
 *   block: object,
 *   onChange: (changes: object) => void,
 *   onModeChange: (mode: 'pct' | 'units') => void,
 *   error?: string,
 * }} props
 */
export default function UpliftField({ block, onChange, onModeChange, error }) {
  const units = block.upliftMode === 'units';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass} id="block-uplift-label">Expected sales uplift</span>
        <div
          role="group"
          aria-labelledby="block-uplift-label"
          className="flex rounded-md border border-lavander bg-lavander/40 p-0.5"
        >
          {UPLIFT_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={block.upliftMode === mode.value}
              onClick={() => onModeChange(mode.value)}
              className={cn(
                'h-6 rounded px-2 text-[11px] font-medium',
                block.upliftMode === mode.value
                  ? 'bg-deep-violet-blue text-white'
                  : 'text-deep-violet-blue/70 hover:bg-white'
              )}
            >
              {mode.label}
            </button>
          ))}
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
              value={block.upliftValue || ''}
              placeholder="e.g. 900"
              aria-labelledby="block-uplift-label"
              onChange={(event) => onChange({ upliftValue: Number(event.target.value) || 0 })}
              className="h-8 w-full rounded-md border border-violet bg-white px-2 text-xs text-deep-violet-blue"
            />
            <span className="shrink-0 text-xs text-deep-violet-blue/70">units in total</span>
          </div>
          <p className="text-[11px] text-deep-violet-blue/50">
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
              max={MAX_UPLIFT_PCT}
              step={1}
              value={block.upliftValue}
              aria-labelledby="block-uplift-label"
              onChange={(event) => onChange({ upliftValue: Number(event.target.value) })}
              className="mr-3 w-full accent-scenario"
            />
            <output htmlFor="block-uplift" className="font-serif text-lg text-scenario">
              +{block.upliftValue}%
            </output>
          </div>
          <div className="flex flex-wrap gap-1">
            {UPLIFT_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ upliftValue: value })}
                className="h-6 rounded-full border border-lavander bg-white px-2 text-[11px] text-deep-violet-blue hover:bg-cream"
              >
                +{value}%
              </button>
            ))}
          </div>
        </>
      )}

      {error ? <p className="mt-0.5 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
