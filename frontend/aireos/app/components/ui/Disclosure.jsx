import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

// The chevron and the Show/Hide words follow their own <details> only -- the
// variant reads "inside the summary of an open details", not group-open, so a
// Disclosure inside an open one does not turn its chevron too. Written out in
// full each time: Tailwind only generates classes it finds whole in the source.

/**
 * A section that opens and closes, built on <details> so it works without
 * JavaScript and with the keyboard. It looks like something to click: a
 * chevron that turns when it opens, a hover highlight on the whole row, and
 * -- in the `bar` variant -- "Show" / "Hide" on the right saying what a click
 * does.
 *
 *   bar   a full-width row, for a block of content (optional fields, unused
 *         columns)
 *   link  a short line of text, for a detail tucked under something else
 *
 * `open` is where it starts; after that the reviewer opens and closes it.
 *
 * @param {{
 *   summary: import('react').ReactNode,
 *   children: import('react').ReactNode,
 *   variant?: 'bar' | 'link',
 *   open?: boolean,
 *   className?: string,
 *   summaryClassName?: string,
 * }} props
 */
export default function Disclosure({ summary, children, variant = 'bar', open = false, className, summaryClassName }) {
  const bar = variant === 'bar';

  return (
    <details open={open} className={className}>
      <summary
        className={cn(
          // Hides the browser's own marker; the chevron replaces it.
          'flex cursor-pointer list-none items-center gap-1.5 rounded-md text-deep-violet-blue outline-none transition-colors select-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue [&::-webkit-details-marker]:hidden',
          bar ? 'px-2 py-1.5 text-xs font-medium hover:bg-cream' : 'w-fit py-0.5 pr-1 text-[11px] font-medium hover:text-deep-violet-blue hover:underline underline-offset-2',
          summaryClassName,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-deep-violet-blue/70 transition-transform [details[open]>summary_&]:rotate-90"
        />
        <span className="min-w-0 flex-1">{summary}</span>
        {bar && (
          <span aria-hidden="true" className="shrink-0 text-[11px] font-medium text-deep-violet-blue/70">
            <span className="[details[open]>summary_&]:hidden">Show</span>
            <span className="hidden [details[open]>summary_&]:inline">Hide</span>
          </span>
        )}
      </summary>
      {children}
    </details>
  );
}
