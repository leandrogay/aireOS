import { CheckCircle2, CircleAlert } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import { cn } from '@/lib/utils';

/**
 * One numbered step of the mapping review, in the dashboard's card style.
 * The number and the done/to-do chip are what let a reviewer see where they
 * are on a long page; the `id` is what the checklist links jump to. What the
 * step is for sits behind an info icon by its title, so the page reads as
 * steps rather than paragraphs.
 *
 * @param {{
 *   id: string,
 *   step: number,
 *   title: string,
 *   info?: import('react').ReactNode,
 *   done?: boolean | null,
 *   doneLabel?: string,
 *   todoLabel?: string,
 *   action?: import('react').ReactNode,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function ReviewSection({
  id,
  step,
  title,
  info,
  done = null,
  doneLabel = 'Done',
  todoLabel = 'Needs you',
  action,
  children,
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      // Leaves room above the heading when a checklist link scrolls here.
      className="scroll-mt-4 rounded-lg border border-lavander bg-white p-3 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              done ? 'bg-green-100 text-green-800' : 'bg-lavander text-deep-violet-blue',
            )}
          >
            {step}
          </span>
          <div className="flex min-w-0 items-center gap-1">
            <h2 id={`${id}-title`} className="text-sm font-medium text-deep-violet-blue">
              <span className="sr-only">Step {step}: </span>
              {title}
            </h2>
            {info && <InfoTooltip label={`About: ${title}`}>{info}</InfoTooltip>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {done !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                done ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-900',
              )}
            >
              {done ? (
                <CheckCircle2 aria-hidden="true" className="size-3" />
              ) : (
                <CircleAlert aria-hidden="true" className="size-3" />
              )}
              {done ? doneLabel : todoLabel}
            </span>
          )}
          {action}
        </div>
      </div>

      {children}
    </section>
  );
}
