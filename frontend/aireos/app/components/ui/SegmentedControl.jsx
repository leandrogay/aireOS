'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { MotionConfig, motion } from 'motion/react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

// Pick exactly one of a few options that share a track, with the active
// background sliding between them. Built on Base UI's Tabs directly (not
// ui/tabs) so it doesn't fight the shadcn defaults; Base UI gives the
// keyboard handling (arrow keys between options) and tablist semantics.

// Same spring as the Sidebar's active highlight, so every slide in the app
// moves alike.
const HIGHLIGHT_SPRING = { type: 'spring', stiffness: 500, damping: 40 };

// `tint`: lavender track, for a switch inside a card (chart metric, form
// mode). `outline`: cream track with a hairline border, for a page's
// top-level tabs. Either way the active option is a white glass-like thumb
// (shadow-thumb: solid, no blur, since it slides inside cards) with a 70%
// deep-blue edge, the 3:1 cue that says which one is picked. A hover is a
// fainter white with no edge, so it never reads as picked. The label keeps its
// weight when picked: a bolder one would change its width and jolt the slide.
// The track's 10px radius less its 2px padding gives the options' 8px.
const TRACK_LOOK = {
  tint: 'rounded-glass-sm bg-lavander',
  outline: 'rounded-glass-sm border border-deep-violet-blue/15 bg-cream',
};
const SEGMENT_HOVER = {
  tint: 'hover:bg-white/40',
  outline: 'hover:bg-white/40',
};
const TRACK_SIZE = {
  sm: 'h-7 text-[11px]',
  md: 'h-8 text-xs',
};

/**
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   options: { value: string, label: string, icon?: import('react').ElementType, disabled?: boolean, title?: string }[],
 *   look?: 'tint' | 'outline',
 *   size?: 'sm' | 'md',
 *   fullWidth?: boolean,
 *   ariaLabel?: string,
 *   className?: string,
 * }} props `fullWidth` stretches the track and shares its width between the options.
 */
export default function SegmentedControl({
  value,
  onChange,
  options,
  look = 'tint',
  size = 'sm',
  fullWidth = false,
  ariaLabel,
  className,
}) {
  // One highlight per control: a shared layoutId across two controls on the
  // same page would make the highlight jump between them.
  const layoutId = `segment-${useId()}`;

  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange} className={cn(fullWidth ? 'w-full' : 'w-fit', className)}>
      {/* reducedMotion="user": the slide is instant for users who ask for less motion. */}
      <MotionConfig transition={HIGHLIGHT_SPRING} reducedMotion="user">
        <TabsPrimitive.List
          aria-label={ariaLabel}
          className={cn('flex items-center gap-0.5 p-0.5', TRACK_LOOK[look], TRACK_SIZE[size], fullWidth ? 'w-full' : 'inline-flex')}
        >
          {options.map((option) => {
            const active = option.value === value;
            const Icon = option.icon;
            return (
              <TabsPrimitive.Tab
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                title={option.title}
                className={cn(
                  // `isolate` keeps the highlight (-z-10) behind the label but above the track.
                  'relative isolate inline-flex h-6 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 font-medium transition-colors duration-hover outline-none',
                  'focus-ring-inset',
                  'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                  fullWidth && 'flex-1',
                  active ? 'text-deep-violet-blue' : cn('text-ink-soft hover:text-deep-violet-blue', SEGMENT_HOVER[look]),
                )}
              >
                {active && (
                  <motion.span
                    layoutId={layoutId}
                    className="absolute inset-0 -z-10 rounded-md border border-deep-violet-blue/70 bg-white shadow-thumb"
                  />
                )}
                {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                <span className="truncate">{option.label}</span>
              </TabsPrimitive.Tab>
            );
          })}
        </TabsPrimitive.List>
      </MotionConfig>
    </TabsPrimitive.Root>
  );
}
