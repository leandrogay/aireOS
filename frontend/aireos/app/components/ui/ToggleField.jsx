'use client';

import { useId } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// The shared Switch is black by default; this is the app's own colouring, the
// same as the DOH alert toggle.
const switchClass = 'data-checked:bg-deep-violet-blue data-unchecked:bg-lavander';

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
 *   className?: string,
 * }} props `label` is shown beside the switch; `ariaLabel` names it when there
 *   is no label. `onHint` / `offHint` explain the state the switch is in now.
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
        className={cn('mt-0.5', switchClass)}
      />
      {hasText && (
        <label htmlFor={id} className={cn('min-w-0 text-xs text-deep-violet-blue', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          <span className="flex items-center gap-1.5">
            {label && <span className="font-medium">{label}</span>}
            {showState && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
                  checked ? 'bg-deep-violet-blue text-white' : 'bg-lavander text-deep-violet-blue/70',
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
