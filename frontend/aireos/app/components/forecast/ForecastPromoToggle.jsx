'use client';

import { cn } from '@/lib/utils';
import { PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';

export default function ForecastPromoToggle({ value, onChange }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        Overlay
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PROMO_OVERLAY_TYPES.map((promo) => {
          const isActive = value === promo.value;
          return (
            <button
              key={promo.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(isActive ? '' : promo.value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition',
                isActive
                  ? 'border-transparent text-deep-violet-blue shadow-sm'
                  : 'border-lavander bg-white text-deep-violet-blue/55 hover:bg-cream'
              )}
              style={
                isActive
                  ? { backgroundColor: `color-mix(in srgb, ${promo.color} 22%, white)` }
                  : undefined
              }
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: promo.swatch ?? promo.strokeColor ?? promo.color }}
                aria-hidden="true"
              />
              {promo.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
