'use client';

import { useId } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// The shared Switch is black by default; these are the app's own colourings.
// `default`: deep violet, the same as the DOH alert toggle. `scenario`: the
// Scenario builder's pink (the scenario tokens in globals.css), as on its
// block and promotion switches.
const SWITCH_TONE = {
  default: 'data-checked:bg-deep-violet-blue',
  scenario: 'data-checked:bg-scenario',
};
// The showState "On" pill, in the same colour as the switch.
const ON_PILL_TONE = {
  default: 'bg-deep-violet-blue text-white',
  scenario: 'bg-scenario text-white',
};

/**
 * A setting that is on or off. With no `label` only the switch is drawn, for
 * a table cell whose column header already names it; give it `ariaLabel`
 * then, so screen readers can still say what it switches. `showState` spells
 * the state out ("On" / "Off") so it never rests on the switch colour alone,
 * and the hints explain what the current state means.
 *
 * @param {{
 *   label?: string,
 *   ariaLabel?: string,
 *   checked: boolean,
 *   onChange: (checked: boolean) => void,
 *   onHint?: string,
 *   offHint?: string,
 *   disabled?: boolean,
 *   showState?: boolean,
 *   tone?: 'default' | 'scenario',
 *   className?: string,
 * }} props `label` is shown beside the switch; `ariaLabel` names it when there
 *   is no label. `onHint` / `offHint` explain the state the switch is in now.
 *   `tone` colours the switch (and the On pill) when it is on.
 */
export default function ToggleField({
  label,
  ariaLabel,
  checked,
  onChange,
  onHint,
  offHint,
  disabled = false,
  showState = false,
  tone = 'default',
  className,
}) {
  const id = useId();
  const hint = checked ? onHint : offHint;
  const hasText = Boolean(label || showState || hint);

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        // A pointer on hover so the switch reads as clickable; the primitive's
        // data-disabled:cursor-not-allowed still wins while it is disabled.
        className={cn('mt-0.5 cursor-pointer', SWITCH_TONE[tone])}
      />
      {hasText && (
        <label htmlFor={id} className={cn('min-w-0 text-xs text-deep-violet-blue', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          <span className="flex items-center gap-1.5">
            {label && <span className="font-medium">{label}</span>}
            {showState && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
                  checked ? ON_PILL_TONE[tone] : 'bg-lavander text-deep-violet-blue/70',
                )}
              >
                {checked ? 'On' : 'Off'}
              </span>
            )}
          </span>
          {hint && <span className="mt-0.5 block text-[11px] text-deep-violet-blue/60">{hint}</span>}
        </label>
      )}
    </div>
  );
}
