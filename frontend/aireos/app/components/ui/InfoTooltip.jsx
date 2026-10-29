'use client';

import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * A small info icon that shows help on hover, for a table column header or
 * a compact form where a hint paragraph under every input (as the single-record
 * inventory form uses) would not fit.
 *
 * @param {object} props
 * @param {string} props.label read by screen readers; not shown
 * @param {import('react').ReactNode} props.children the hint text, or a small card of it
 * @param {string} [props.className] for the popup, e.g. a wider card
 */
export default function InfoTooltip({ label, children, className }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={100}
        className="rounded-full p-0.5 text-deep-violet-blue/50 hover:text-deep-violet-blue"
      >
        <Info className="size-3.5" />
        <span className="sr-only">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-64 text-xs font-normal text-deep-violet-blue/80', className)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
