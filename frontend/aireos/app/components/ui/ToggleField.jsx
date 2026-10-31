'use client';

import { useId } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// The shared Switch is black by default; this is the app's own colouring, the
// same as the DOH alert toggle.
const switchClass = 'data-checked:bg-deep-violet-blue data-unchecked:bg-lavander';

/**
 * A setting that is on or off: the switch, what it does, and what the current
 * state means. The whole row is clickable, and the state is spelled out
 * ("On" / "Off") so it never rests on the switch colour alone.
 *
 * @param {{
 *   label: string,
 *   checked: boolean,
 *   onChange: (checked: boolean) => void,
 *   onHint?: string,
 *   offHint?: string,
 *   disabled?: boolean,
 *   className?: string,
 * }} props `onHint` / `offHint` explain the state the switch is in now.
 */
export default function ToggleField({ label, checked, onChange, onHint, offHint, disabled = false, className }) {
  const id = useId();
  const hint = checked ? onHint : offHint;

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className={cn('mt-0.5', switchClass)}
      />
      <label htmlFor={id} className={cn('min-w-0 text-xs text-deep-violet-blue', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{label}</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
              checked ? 'bg-deep-violet-blue text-white' : 'bg-lavander text-deep-violet-blue/70',
            )}
          >
            {checked ? 'On' : 'Off'}
          </span>
        </span>
        {hint && <span className="mt-0.5 block text-[11px] text-deep-violet-blue/60">{hint}</span>}
      </label>
    </div>
  );
}
