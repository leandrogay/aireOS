'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// cursor-default: the icon only shows a hint on hover and does nothing on
// click, so a pointer hand would invite a click that goes nowhere.
const triggerClass = 'cursor-default rounded-full p-0.5 text-deep-violet-blue/50 hover:text-deep-violet-blue';

// An ⓘ hint is deep blue with white text, unlike the app's other tooltips
// (ui/tooltip's white bubble). *:data-[side] is the bubble's arrow, its one
// child with a data-side, so it turns blue with the bubble.
const hintClass =
  'block max-w-64 border-transparent bg-deep-violet-blue text-left font-normal leading-snug text-white ' +
  '*:data-[side]:bg-deep-violet-blue *:data-[side]:fill-deep-violet-blue';

/**
 * A small info icon that shows help on hover, for a table column header,
 * a filter label or a compact form where a hint paragraph under every input
 * (as the single-record inventory form uses) would not fit.
 *
 * The help is a deep blue bubble with white text and an arrow (ui/tooltip,
 * recoloured). The pointer can move onto the bubble, so `learnMore`
 * ({ label?, onClick }) can put a bold, underlined link under the text (the
 * Forecast page's ⓘ open its help panel this way); the link closes the hint.
 *
 * A hint that is a small card with its own coloured text (the mapping field
 * details) uses `variant="card"`: a white popover, which also stays open
 * while the pointer is on it.
 *
 * @param {object} props
 * @param {string} props.label read by screen readers; not shown
 * @param {import('react').ReactNode} props.children the hint text, or a small card of it
 * @param {'tooltip' | 'card'} [props.variant]
 * @param {string} [props.className] for the popup, e.g. a wider card
 * @param {{ label?: string, onClick: () => void } | null} [props.learnMore] a link under the hint, tooltip only
 */
export default function InfoTooltip({ label, children, variant = 'tooltip', className, learnMore = null }) {
  const [open, setOpen] = useState(false);
  const icon = (
    <>
      <Info className="size-3.5" />
      <span className="sr-only">{label}</span>
    </>
  );

  if (variant === 'card') {
    return (
      <Popover>
        <PopoverTrigger openOnHover delay={150} closeDelay={100} className={triggerClass}>
          {icon}
        </PopoverTrigger>
        <PopoverContent align="start" className={cn('w-64 text-xs font-normal text-deep-violet-blue/80', className)}>
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger delay={150} closeDelay={100} className={triggerClass}>
        {icon}
      </TooltipTrigger>
      <TooltipContent className={cn(hintClass, className)}>
        {children}
        {learnMore ? (
          <button
            type="button"
            onClick={() => {
              // Closed first, so it doesn't sit over what the link opens.
              setOpen(false);
              learnMore.onClick();
            }}
            className="mt-1.5 block w-fit cursor-pointer font-bold text-white underline underline-offset-2 hover:text-white/80"
          >
            {learnMore.label ?? 'Learn more'}
          </button>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
