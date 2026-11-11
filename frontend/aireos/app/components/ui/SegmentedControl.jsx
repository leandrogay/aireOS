'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { MotionConfig, motion } from 'motion/react';
import { useId } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Pick exactly one of a few options that share a track, with the active
// background sliding between them. Built on Base UI's Tabs directly (not
// ui/tabs) so it doesn't fight the shadcn defaults; Base UI gives the
// keyboard handling (arrow keys between options) and tablist semantics.

// Same spring as the Sidebar's active highlight, so every slide in the app
// moves alike.
const HIGHLIGHT_SPRING = { type: 'spring', stiffness: 500, damping: 40 };

// `tint`: lavender track, for a switch inside a card (chart metric, form
// mode). `outline`: white track with a border, for a page's top-level tabs.
const TRACK_LOOK = {
  tint: 'rounded-lg bg-lavander',
  outline: 'rounded-md border border-violet/40 bg-white',
};
// not-data-disabled: a disabled option keeps its faded look under the pointer.
const SEGMENT_HOVER = {
  tint: 'not-data-disabled:hover:bg-white/60',
  outline: 'not-data-disabled:hover:bg-cream',
};
const TRACK_SIZE = {
  sm: 'h-7 text-[11px]',
  md: 'h-8 text-xs',
};

/**
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   options: { value: string, label: string, icon?: import('react').ElementType, disabled?: boolean, disabledReason?: string, title?: string }[],
 *   look?: 'tint' | 'outline',
 *   size?: 'sm' | 'md',
 *   fullWidth?: boolean,
 *   ariaLabel?: string,
 *   className?: string,
 * }} props `fullWidth` stretches the track and shares its width between the options.
 * An option with `disabled` stays in the track, faded, and can't be picked;
 * give it a `disabledReason` (e.g. "No weekly data in this range") to say why
 * in a tooltip on hover.
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
            const tab = (
              <TabsPrimitive.Tab
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                title={option.title}
                className={cn(
                  // `isolate` keeps the highlight (-z-10) behind the label but above the track.
                  'relative isolate inline-flex h-6 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 font-medium transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet',
                  // Base UI marks a disabled tab with data-disabled / aria-disabled, not the
                  // native `disabled` attribute (it stays focusable), so `disabled:` never matches.
                  'cursor-pointer data-disabled:cursor-not-allowed data-disabled:opacity-40',
                  fullWidth && 'flex-1',
                  active
                    ? 'text-white'
                    : cn('text-deep-violet-blue/70 not-data-disabled:hover:text-deep-violet-blue', SEGMENT_HOVER[look]),
                )}
              >
                {active && (
                  <motion.span
                    layoutId={layoutId}
                    className="absolute inset-0 -z-10 rounded-md bg-deep-violet-blue shadow-sm"
                  />
                )}
                {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                <span className="truncate">{option.label}</span>
                {/* The tooltip is hover-only, so screen readers get the reason with the label. */}
                {option.disabled && option.disabledReason && <span className="sr-only">, {option.disabledReason}</span>}
              </TabsPrimitive.Tab>
            );
            if (!option.disabled || !option.disabledReason) return tab;
            // The tab is the tooltip's trigger (render), so the whole segment answers the
            // hover. It still gets pointer events: aria-disabled, not native disabled.
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger delay={150} closeDelay={100} render={tab} />
                <TooltipContent>{option.disabledReason}</TooltipContent>
              </Tooltip>
            );
          })}
        </TabsPrimitive.List>
      </MotionConfig>
    </TabsPrimitive.Root>
  );
}
