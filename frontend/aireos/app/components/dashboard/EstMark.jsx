'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { estimateNote, hasEstimate } from '@/app/utils/estimatedRevenue';
import { cn } from '@/lib/utils';

// A small tag: soft lavender fill and a hairline violet outline -- the
// same fill and outline as the page-header Offline / Online switch
// (ChannelSwitch), so it stands out without competing with the figures.
// Fixed height and leading-none so it never makes a table row taller.
// Shared with the customer chart's tooltip, which has no hover note of its own.
export const ESTIMATE_PILL_CLASS =
  'inline-flex h-[18px] shrink-0 items-center rounded-full bg-lavander/25 px-1.5 text-[11px] font-semibold leading-none text-deep-violet-blue/80 ring-1 ring-violet/25';

/**
 * "est." for a revenue figure that includes estimated revenue; hovering it
 * says how much (utils/estimatedRevenue) -- a tooltip, so it shows only while
 * hovered and never stays open after a click. Renders nothing when there
 * is no estimate, so it can sit beside every revenue figure. A small pill
 * (ESTIMATE_PILL_CLASS) so it reads as a marker rather than loose text.
 *
 * @param {object} props
 * @param {number} props.estimated the estimated part of the figure
 * @param {number} props.total the whole figure
 * @param {string} [props.className]
 */
export default function EstMark({ estimated, total, className }) {
  if (!hasEstimate(estimated)) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        delay={150}
        closeDelay={100}
        className={cn(
          ESTIMATE_PILL_CLASS,
          'cursor-default transition-colors hover:bg-lavander/50 hover:text-deep-violet-blue',
          className,
        )}
      >
        est.
        <span className="sr-only">: includes estimated revenue</span>
      </TooltipTrigger>
      {/* Keep the estimate note as a compact hover card without an arrow. */}
      <TooltipContent
        side="bottom"
        align="end"
        className="max-w-64 rounded-lg bg-popover p-2.5 text-xs font-normal text-deep-violet-blue/80 shadow-md ring-1 ring-foreground/10 *:data-[side]:hidden"
      >
        {estimateNote(estimated, total)}
      </TooltipContent>
    </Tooltip>
  );
}
