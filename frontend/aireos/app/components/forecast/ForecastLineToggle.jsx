'use client';

import { cn } from '@/lib/utils';
import { FORECAST_SERIES } from '@/app/utils/forecastView';

function SeriesMark({ color, shape }) {
  if (shape === 'square') {
    return <span className="size-2 shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />;
  }
  if (shape === 'diamond') {
    return (
      <span
        className="size-1.5 shrink-0 rotate-45"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    );
  }
  if (shape === 'triangle') {
    return (
      <span
        className="shrink-0 border-x-[4px] border-x-transparent border-b-[7px]"
        style={{ borderBottomColor: color }}
        aria-hidden="true"
      />
    );
  }
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />;
}

/**
 * Line on/off pills. `hints` maps a series key to a short explanation shown
 * on hover or keyboard focus of that pill (e.g. why Initial is missing).
 *
 * @param {{
 *   visible: Record<string, boolean>,
 *   onToggle: (key: string) => void,
 *   hints?: Record<string, string | null>,
 * }} props
 */
export default function ForecastLineToggle({ visible, onToggle, hints = {} }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        Lines
      </p>
      <div className="flex flex-wrap gap-1.5">
        {FORECAST_SERIES.map((series) => {
          const isActive = visible[series.key];
          const hint = hints[series.key];
          const hintId = `forecast-line-hint-${series.key}`;
          return (
            <span key={series.key} className="group relative inline-flex">
              <button
                type="button"
                aria-pressed={isActive}
                aria-describedby={hint ? hintId : undefined}
                onClick={() => onToggle(series.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition',
                  isActive
                    ? 'border-transparent text-deep-violet-blue shadow-sm'
                    : 'border-lavander bg-white text-deep-violet-blue/55 hover:bg-cream'
                )}
                style={
                  isActive
                    ? { backgroundColor: `color-mix(in srgb, ${series.color} 20%, white)` }
                    : undefined
                }
              >
                <SeriesMark color={series.color} shape={series.shape} />
                {series.label}
              </button>
              {hint ? (
                <span
                  id={hintId}
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1.5 w-72 rounded-md border border-lavander bg-white px-2.5 py-2 text-[11px] leading-snug text-deep-violet-blue opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                >
                  {hint}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
