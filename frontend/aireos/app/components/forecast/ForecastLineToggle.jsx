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

export default function ForecastLineToggle({ visible, onToggle }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        Lines
      </p>
      <div className="flex flex-wrap gap-1.5">
        {FORECAST_SERIES.map((series) => {
          const isActive = visible[series.key];
          return (
            <button
              key={series.key}
              type="button"
              aria-pressed={isActive}
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
          );
        })}
      </div>
    </div>
  );
}
