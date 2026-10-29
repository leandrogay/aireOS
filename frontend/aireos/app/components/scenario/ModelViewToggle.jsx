'use client';

import { cn } from '@/lib/utils';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { MODEL_VIEWS } from '@/app/utils/scenarioModelView';

const OPTIONS = [
  { value: MODEL_VIEWS.official, label: 'Modify Planned Promotions' },
  { value: MODEL_VIEWS.planned, label: 'Simulate New Promotions' },
];

function message({ disabled, summary, value, loading, error }) {
  if (disabled) {
    return 'Not needed for this SKU: none of its forecast months already include an entered promotion (they are Tier 1 basic or Tier 0), so promotions can be planned for every month.';
  }
  if (error) return `The forecast without the model's promotions could not be loaded: ${error}`;
  const which = `${summary.modelMonths} of ${summary.totalMonths} forecast months (${summary.months.map(formatMonthLabel).join(', ')})`;
  if (value === MODEL_VIEWS.planned) {
    return loading
      ? 'Loading the forecast without the model’s promotions…'
      : `${which} use the Tier 1 basic or Tier 0 forecast instead, so you can plan promotions there yourself. The grey dotted line is the official forecast.`;
  }
  return `${which} are Tier 1 advanced and already include the promotion entered for them, so promotions you plan are not added there. Switch to Simulate New Promotions to plan them yourself.`;
}

/**
 * Switch between the official forecast and one the user can add their own
 * promotions to, for one customer and one SKU (see
 * app/utils/scenarioModelView.js). Greyed
 * out, with the reason, when no month of the SKU already includes an
 * entered promotion.
 *
 * @param {{
 *   value: 'official' | 'planned',
 *   onChange: (view: string) => void,
 *   disabled?: boolean,
 *   summary: { modelMonths: number, totalMonths: number, months: string[] },
 *   loading?: boolean,
 *   error?: string | null,
 * }} props
 */
export default function ModelViewToggle({ value, onChange, disabled = false, summary, loading = false, error = null }) {
  const text = message({ disabled, summary, value, loading, error });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-lavander bg-white px-3 py-2 text-xs text-deep-violet-blue">
      <div
        className={cn('flex rounded-md bg-lavander p-0.5', disabled && 'opacity-50')}
        role="group"
        aria-label="Forecast view"
        title={disabled ? text : undefined}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-6 rounded px-2.5 text-[11px] font-medium transition disabled:cursor-not-allowed',
              value === option.value ? 'bg-deep-violet-blue text-white' : 'text-deep-violet-blue/70 hover:bg-white',
              disabled && 'hover:bg-transparent'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="min-w-0 flex-1 text-[11px] text-deep-violet-blue/70">{text}</p>
    </div>
  );
}
