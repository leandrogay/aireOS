'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const triggerClass = 'cursor-pointer rounded-full p-0.5 text-deep-violet-blue/50 hover:text-deep-violet-blue';

/**
 * A small info icon that shows help on hover, for a table column header,
 * a filter label or a compact form where a hint paragraph under every input
 * (as the single-record inventory form uses) would not fit.
 *
 * The help is the dark tooltip bubble with an arrow (ui/tooltip). The pointer
 * can move onto the bubble, so `learnMore` ({ label?, onClick }) can put a
 * bold, underlined link under the text (the Forecast page's ⓘ open its help
 * panel this way). The icon also opens it on click or tap (touch has no
 * hover); Escape or the link closes it.
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
      <TooltipTrigger
        delay={150}
        closeDelay={100}
        className={triggerClass}
        // A tap opens it too; a hover has usually opened it already, so
        // this opens rather than toggles.
        onClick={() => setOpen(true)}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent className={cn('block max-w-64 text-left font-normal leading-snug', className)}>
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
