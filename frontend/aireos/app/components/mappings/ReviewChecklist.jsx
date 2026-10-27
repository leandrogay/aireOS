'use client';

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { primaryButtonClass } from '@/components/inventory/formStyles';
import { cn } from '@/lib/utils';

/**
 * "What's left": every condition approval waits on (utils/reviewChecklist),
 * ticked off as the reviewer works, each a link to the section that settles
 * it, with the Approve button under the list it depends on. Sticky beside the
 * sections on a wide screen, so the answer to "what do I still have to do?"
 * never scrolls away.
 *
 * @param {{
 *   items: { id: string, label: string, done: boolean, detail: string, href: string }[],
 *   isConfirmed: boolean,
 *   changed: boolean,
 *   busy: string | null,
 *   error: string,
 *   onApprove: () => void,
 * }} props
 */
export default function ReviewChecklist({ items, isConfirmed, changed, busy, error, onApprove }) {
  const left = items.filter((item) => !item.done).length;
  const ready = left === 0;
  // A live mapping with nothing changed has nothing to approve.
  const nothingToSave = isConfirmed && !changed;

  let summary;
  if (nothingToSave) summary = 'No changes yet.';
  else if (ready) summary = 'Ready.';
  else summary = `${left} left`;

  return (
    <aside
      aria-labelledby="review-checklist-title"
      className="rounded-lg border border-lavander bg-white p-3 shadow-sm lg:sticky lg:top-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="review-checklist-title" className="text-sm font-medium text-deep-violet-blue">
          What&apos;s left
        </h2>
        <p role="status" className={cn('text-xs', ready && !nothingToSave ? 'text-green-700' : 'text-deep-violet-blue/70')}>
          {summary}
        </p>
      </div>

      <ol className="mt-2 space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              className="flex items-start gap-2 rounded-md px-1.5 py-1 outline-none transition hover:bg-cream focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
            >
              {item.done ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-green-700" />
              ) : (
                <Circle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
              )}
              <span className="min-w-0">
                <span className={cn('block text-xs', item.done ? 'text-deep-violet-blue/60' : 'font-medium text-deep-violet-blue')}>
                  <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
                  {item.label}
                </span>
                {/* Only what is still open explains itself. */}
                {item.detail && !item.done && (
                  <span className="block text-[11px] text-amber-900">
                    {item.detail}
                  </span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1">
        <Button
          type="button"
          onClick={onApprove}
          disabled={!ready || nothingToSave || busy !== null}
          className={cn(primaryButtonClass, 'flex-1')}
        >
          {busy === 'approve' && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {busy === 'approve' ? 'Saving…' : isConfirmed ? 'Save new version' : 'Approve mapping'}
        </Button>
        <InfoTooltip label="What approving does">
          {/* Approving saves instructions and loads nothing; loading is the
              next, confirmed step (ApprovedSummary → LoadConfirmDialog). */}
          {isConfirmed
            ? 'Saves the new version. Sales data already loaded is left as it is; you can reload those files with the new version next.'
            : 'Saves how files with this layout are read. No sales data is loaded yet: you check and load the waiting files next.'}
        </InfoTooltip>
      </div>
    </aside>
  );
}
