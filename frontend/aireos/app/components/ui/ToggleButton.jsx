'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';

import { cn } from '@/lib/utils';

// One thing on or off, as a button that stays pressed (aria-pressed via Base
// UI's Toggle, which also sets data-pressed for the styles below). For a
// setting with a switch and an explanation use ToggleField; for one-of-a-few
// use SegmentedControl.

// `compact`: fills its column in an inventory filter card, the same height as
// the compact dropdowns beside it. `chip`: a rounded pill for a row of
// on/off filters (chart lines, store formats).
const LOOK = {
  compact:
    'h-8 w-full justify-center rounded-md border border-deep-violet-blue/40 bg-white px-2 text-xs shadow-sm hover:bg-cream data-pressed:border-deep-violet-blue data-pressed:bg-deep-violet-blue data-pressed:text-white data-pressed:hover:bg-deep-violet-blue/90',
  chip:
    'h-7 rounded-full border border-lavander bg-white px-2.5 text-[11px] text-deep-violet-blue/60 hover:bg-cream hover:text-deep-violet-blue data-pressed:border-deep-violet-blue data-pressed:bg-deep-violet-blue data-pressed:text-white data-pressed:hover:bg-deep-violet-blue/90',
};

/**
 * @param {{
 *   pressed: boolean,
 *   onChange: (pressed: boolean) => void,
 *   look?: 'compact' | 'chip',
 *   disabled?: boolean,
 *   title?: string,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function ToggleButton({ pressed, onChange, look = 'compact', disabled = false, title, className, children }) {
  return (
    <TogglePrimitive
      pressed={pressed}
      onPressedChange={onChange}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium text-deep-violet-blue outline-none transition',
        'cursor-pointer focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50',
        LOOK[look],
        className,
      )}
    >
      {children}
    </TogglePrimitive>
  );
}
