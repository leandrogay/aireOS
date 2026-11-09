'use client';

import { ArrowLeft, Check, Lightbulb, Loader2, PanelsTopLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GUIDED_STEPS } from '@/app/utils/guidedSteps';
import { cn } from '@/lib/utils';

// Secondary text on this review is never lighter than /80: lighter shades of
// deep-violet-blue fall under 4.5:1 on white, cream and lavender (WCAG AA).

/**
 * Every screen of the review down the side, in order: done ones ticked, the
 * current one filled, the ones this mapping has nothing to ask on marked
 * "nothing to do". A screen already visited can be jumped back (or forward) to.
 *
 * @param {{
 *   steps: string[],
 *   stepKey: string | null,
 *   visited: string[],
 *   onGoTo?: (key: string) => void,
 *   finished?: boolean,
 * }} props
 */
export function StepRail({ steps, stepKey, visited, onGoTo, finished = false }) {
  const current = steps.indexOf(stepKey);

  return (
    <nav aria-label="Review steps" className="rounded-lg border border-lavander bg-white p-3 shadow-sm lg:sticky lg:top-4">
      <ol className="space-y-0.5">
        {Object.keys(GUIDED_STEPS).map((key) => {
          const index = steps.indexOf(key);
          const skipped = index < 0;
          const isCurrent = !finished && key === stepKey;
          const done = finished || (!skipped && index < current);
          const canOpen = !finished && !isCurrent && !skipped && visited.includes(key) && onGoTo;

          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                isCurrent && 'bg-deep-violet-blue text-white',
                done && 'bg-green-100 text-green-800',
                skipped && 'border border-lavander text-deep-violet-blue/80',
                !isCurrent && !done && !skipped && 'bg-lavander text-deep-violet-blue',
              )}
            >
              {done || skipped ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
          );
          const text = (
            <span className="min-w-0">
              <span className={cn('block text-sm', isCurrent ? 'font-medium text-deep-violet-blue' : 'text-deep-violet-blue/80')}>
                {GUIDED_STEPS[key].label}
              </span>
              {skipped && <span className="block text-xs text-deep-violet-blue/80">Nothing to do</span>}
            </span>
          );
          const rowClass = cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left', isCurrent && 'bg-lavander/60');

          return (
            <li key={key} aria-current={isCurrent ? 'step' : undefined}>
              {canOpen ? (
                <button
                  type="button"
                  onClick={() => onGoTo(key)}
                  className={cn(rowClass, 'transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue')}
                >
                  {marker}
                  {text}
                </button>
              ) : (
                <div className={rowClass}>
                  {marker}
                  {text}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The frame around every screen of the guided review: the step list on the
 * left (a progress bar on a narrow screen), and the screen as one card -- the
 * question, the screen itself, a tip, and Back / Continue in its footer, held
 * at the bottom of the window while a long screen scrolls.
 *
 * @param {{
 *   steps: string[],
 *   stepKey: string,
 *   visited: string[],
 *   onGoTo: (key: string) => void,
 *   subtitle?: import('react').ReactNode,
 *   tip?: import('react').ReactNode,
 *   onBack?: () => void,
 *   onFullEditor: () => void,
 *   primary?: { label: string, onClick: () => void, disabled?: boolean, busy?: boolean, note?: import('react').ReactNode },
 *   children: import('react').ReactNode,
 * }} props
 */
export default function GuidedFrame({ steps, stepKey, visited, onGoTo, subtitle, tip, onBack, onFullEditor, primary, children }) {
  const index = steps.indexOf(stepKey);
  const total = steps.length;
  const step = GUIDED_STEPS[stepKey];

  return (
    <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
      <div className="hidden lg:block">
        <StepRail steps={steps} stepKey={stepKey} visited={visited} onGoTo={onGoTo} />
      </div>

      <section aria-labelledby="guided-step-title" className="min-w-0 rounded-lg border border-lavander bg-white shadow-sm">
        <header className="border-b border-lavander px-4 py-4 sm:px-5">
          {/* The step list is too wide for a phone: a bar says how far along instead. */}
          <div
            role="progressbar"
            aria-label="Review progress"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            className="mb-3 h-1.5 overflow-hidden rounded-full bg-lavander lg:hidden"
          >
            <div className="h-full rounded-full bg-deep-violet-blue transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-deep-violet-blue/80">
                Step {index + 1} of {total}
                <span className="lg:hidden"> · {step.label}</span>
              </p>
              <h2 id="guided-step-title" className="mt-0.5 font-serif text-xl text-deep-violet-blue md:text-2xl">
                {step.title}
              </h2>
              {subtitle && <p className="mt-1 text-sm text-deep-violet-blue/80">{subtitle}</p>}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onFullEditor} title="Open this nomenclature in the full editor">
              <PanelsTopLeft aria-hidden="true" />
              Full editor
            </Button>
          </div>
        </header>

        <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>

        {tip && (
          <p className="flex items-start gap-2 border-t border-lavander bg-cream/40 px-4 py-2.5 text-sm text-deep-violet-blue sm:px-5">
            <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {tip}
          </p>
        )}

        {primary && (
          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-b-lg border-t border-lavander bg-white px-4 py-3 sm:px-5">
            <Button type="button" variant="outline" onClick={onBack} disabled={!onBack}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <div className="min-w-0 flex-1 text-right">{primary.note}</div>
            <Button type="button" size="lg" onClick={primary.onClick} disabled={primary.disabled || primary.busy} className="min-w-36">
              {primary.busy && <Loader2 aria-hidden="true" className="animate-spin" />}
              {primary.label}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}

/**
 * Tailwind classes for a selectable card, in the review's usual radio-card
 * look (as ChannelSplit's): a lavender outline, deep-violet once picked.
 *
 * @param {boolean} selected
 */
export function choiceCardClass(selected) {
  return cn(
    'flex w-full items-start gap-3 rounded-lg border bg-white p-3 text-left text-deep-violet-blue transition outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-not-allowed disabled:opacity-60',
    selected ? 'border-deep-violet-blue bg-lavander/40 ring-1 ring-deep-violet-blue' : 'cursor-pointer border-lavander hover:bg-cream/60',
  );
}
