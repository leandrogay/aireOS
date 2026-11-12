'use client';

import { useId } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// The track colours live in the switch tokens (globals.css), which keep 3:1
// on glass in both themes. `default`: deep blue (lavender in dark), as on the
// DOH alert toggle. `scenario`: the Scenario builder's pink, as on its block
// and promotion switches.
const SWITCH_TONE = {
  default: '',
  scenario: 'data-checked:bg-switch-on-scenario',
};
// The showState "On" pill, filled like the track; text at 4.5:1 or better.
// White on the scenario pink is only 4.46:1, so the light pill uses the
// deeper scenario ink.
const ON_PILL_TONE = {
  default: 'bg-switch-on text-switch-thumb-on',
  scenario: 'bg-scenario-ink text-white dark:bg-switch-on-scenario dark:text-switch-thumb-on',
};
// "Off" is outlined rather than filled, so On / Off differ by shape as well
// as colour.
const OFF_PILL = 'border border-switch-off-edge bg-transparent text-deep-violet-blue';

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
 *   align?: 'start' | 'top' | 'center',
 *   className?: string,
 * }} props `label` is shown beside the switch; `ariaLabel` names it when there
 *   is no label. `onHint` / `offHint` explain the state the switch is in now.
 *   `tone` colours the switch (and the On pill) when it is on. `align="top"`
 *   sets the switch a little
 *   lower, so its top meets the top of the label's text (the Forecast legend's
 *   budget switch); `align="center"` centres it on the label and hint together,
 *   for switches stacked in one card.
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
  align = 'start',
  className,
}) {
  const centred = align === 'center';
  const top = align === 'top';
  const id = useId();
  const hint = checked ? onHint : offHint;
  const hasText = Boolean(label || showState || hint);

  return (
    <div className={cn('flex gap-2.5', centred ? 'items-center' : 'items-start', className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        // A pointer on hover so the switch reads as clickable. It stays a
        // pointer while disabled (a save in flight) so the cursor doesn't
        // flash a not-allowed sign between the click and the slide.
        className={cn('shrink-0 cursor-pointer', top && 'mt-1', SWITCH_TONE[tone])}
      />
      {hasText && (
        <label htmlFor={id} className={cn('min-w-0 cursor-pointer text-xs text-deep-violet-blue', top ? 'pt-px' : !centred && 'pt-[3px]')}>
          <span className="flex items-center gap-1.5">
            {label && <span className="font-medium">{label}</span>}
            {showState && (
              <span
                className={cn(
                  'rounded-full border border-transparent px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
                  checked ? ON_PILL_TONE[tone] : OFF_PILL,
                )}
              >
                {checked ? 'On' : 'Off'}
              </span>
            )}
          </span>
          {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
        </label>
      )}
    </div>
  );
}
