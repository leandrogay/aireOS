'use client';

import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * A small info icon that shows field help on hover, for a table column
 * header where a hint paragraph under every input (as the single-record form
 * uses) would not fit.
 *
 * @param {object} props
 * @param {string} props.label read by screen readers; not shown
 * @param {string} props.children the hint text
 */
export default function InfoTooltip({ label, children }) {
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
      <PopoverContent align="start" className="w-64 text-xs font-normal text-deep-violet-blue/80">
        {children}
      </PopoverContent>
    </Popover>
  );
}
