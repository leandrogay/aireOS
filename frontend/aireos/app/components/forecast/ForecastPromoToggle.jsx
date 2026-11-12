'use client';

import { cn } from '@/lib/utils';
import ForecastInfo from '@/components/forecast/ForecastInfo';
import { PACK_OVERLAY_TYPES, PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';

function PillGroup({ label, helpKey, options, selected, onToggle }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <p className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        {label}
        <ForecastInfo helpKey={helpKey} label={`About ${label}`} />
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isActive = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onToggle(option.value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition',
                isActive
                  ? 'border-transparent font-semibold shadow-sm'
                  : 'border-deep-violet-blue/15 bg-white/40 text-deep-violet-blue/60 hover:bg-white/70'
              )}
              style={
                isActive
                  ? { backgroundColor: option.selectedBg, color: option.selectedFg }
                  : undefined
              }
            >
              <span
                className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                style={{
                  backgroundColor: isActive ? option.selectedFg : option.swatch,
                  opacity: isActive ? 0.9 : 1,
                }}
                aria-hidden="true"
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ForecastPromoToggle({
  selectedTypes,
  onToggleType,
  selectedPacks,
  onTogglePack,
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <PillGroup
        label="Overlay"
        helpKey="overlay"
        options={PROMO_OVERLAY_TYPES}
        selected={selectedTypes}
        onToggle={onToggleType}
      />
      <PillGroup
        label="Pack"
        helpKey="packs"
        options={PACK_OVERLAY_TYPES}
        selected={selectedPacks}
        onToggle={onTogglePack}
      />
    </div>
  );
}
