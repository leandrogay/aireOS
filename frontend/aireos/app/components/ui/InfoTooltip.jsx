'use client';

import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// cursor-default: the icon only shows a hint on hover and does nothing on
// click, so a pointer hand would invite a click that goes nowhere.
const triggerClass = 'cursor-default rounded-full p-0.5 text-deep-violet-blue/50 hover:text-deep-violet-blue';

/**
 * A small info icon that shows help on hover, for a table column header or
 * a compact form where a hint paragraph under every input (as the single-record
 * inventory form uses) would not fit.
 *
 * The help is the dark tooltip bubble with an arrow (ui/tooltip). A hint that
 * is a small card with its own coloured text (the mapping field details) uses
 * `variant="card"`: a white popover, which also stays open while the pointer
 * is on it.
 *
 * @param {object} props
 * @param {string} props.label read by screen readers; not shown
 * @param {import('react').ReactNode} props.children the hint text, or a small card of it
 * @param {'tooltip' | 'card'} [props.variant]
 * @param {string} [props.className] for the popup, e.g. a wider card
 */
export default function InfoTooltip({ label, children, variant = 'tooltip', className }) {
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
    <Tooltip>
      <TooltipTrigger delay={150} closeDelay={100} className={triggerClass}>
        {icon}
      </TooltipTrigger>
      <TooltipContent className={cn('block max-w-64 text-left font-normal leading-snug', className)}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
