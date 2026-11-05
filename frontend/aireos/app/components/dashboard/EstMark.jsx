'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { estimateNote, hasEstimate } from '@/app/utils/estimatedRevenue';
import { cn } from '@/lib/utils';

/**
 * "EST" for a revenue figure that includes estimated revenue; hovering it
 * says how much (utils/estimatedRevenue) -- a tooltip, so it shows only while
 * hovered and never stays open after a click. Renders nothing when there
 * is no estimate, so it can sit beside every revenue figure. Plain small text;
 * a caller can set its size with `className` (the chart and ranking use the
 * ranking table's text-xs).
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
          'shrink-0 text-[10px] font-semibold tracking-wider text-violet hover:text-deep-violet-blue',
          className,
        )}
      >
        EST
        <span className="sr-only">: includes estimated revenue</span>
      </TooltipTrigger>
      {/* The white card of the app's other hover cards, not the tooltip's
          default dark bubble; *:data-[side]:hidden hides that bubble's arrow
          (its one child with a data-side), which would stay dark. */}
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
