'use client';

import { CalendarDays, CalendarRange, CheckCircle2 } from 'lucide-react';

import ResetButton from '../mappings/ResetButton';
import { choiceCardClass } from './GuidedFrame';

// The two answers, each with a two-line example of what loads.
const OPTIONS = [
  {
    value: false,
    Icon: CalendarDays,
    label: 'Keep the rows as they are',
    help: 'Each row loads as the file has it. Weekly files stay weekly, so the dashboard can show weeks.',
    example: ['Week of 6 Jan · Pants L · 40', 'Week of 13 Jan · Pants L · 35'],
  },
  {
    value: true,
    Icon: CalendarRange,
    label: 'Add them up into months',
    help: 'Rows for the same store, product and month are added together. For daily or per-delivery files.',
    example: ['Jan 2026 · Pants L · 75'],
  },
];

/**
 * "Keep the rows, or add them up by month?" -- the whole-file roll-up
 * (contract `aggregate`, FileSettings on the full review), asked only when the
 * file is not plainly monthly or already rolls up.
 *
 * @param {{ review: ReturnType<import('@/hooks/useGuidedReview').default>, disabled: boolean }} props
 */
export default function RollupStep({ review, disabled }) {
  const { edits } = review;
  const aggregate = edits.instructions.aggregate;

  return (
    <>
      <div role="radiogroup" aria-label="How rows load" className="grid gap-3 md:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = aggregate === option.value;
          const { Icon } = option;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => edits.setInstruction('aggregate', option.value)}
              className={choiceCardClass(selected)}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-deep-violet-blue" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-sm text-deep-violet-blue/80">{option.help}</span>
                <span className="mt-2 block space-y-0.5 rounded-md bg-cream/40 px-2 py-1.5 font-mono text-xs text-deep-violet-blue">
                  {option.example.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </span>
              {selected && <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-deep-violet-blue" />}
            </button>
          );
        })}
      </div>

      {edits.instructionsChanged && (
        <div className="flex justify-end">
          <ResetButton
            text="Undo my change on this screen"
            label="Put the roll-up back as the AI proposed it"
            onClick={edits.resetInstructions}
            disabled={disabled}
            className="text-sm text-deep-violet-blue"
          />
        </div>
      )}
    </>
  );
}
