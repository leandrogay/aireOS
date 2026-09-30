import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * What is left of the review, next to the table it is about.
 *
 * Only low-confidence columns are counted: they are the only rows an approval
 * waits on, so a count of anything else would be progress towards nothing.
 * A mapping the proposal was sure of throughout has nothing to count and shows
 * nothing.
 *
 * role="status" makes it a polite live region, so a screen reader hears the
 * count change as rows are confirmed without losing its place in the table.
 *
 * @param {{ total: number, remaining: number }} props
 */
export default function ReviewProgress({ total, remaining }) {
  if (!total) return null;

  const done = remaining === 0;
  const Icon = done ? CheckCircle2 : AlertTriangle;

  let label;
  if (done) {
    label = total === 1
      ? 'Low-confidence column reviewed'
      : `All ${total} low-confidence columns reviewed`;
  } else {
    label = total === 1
      ? '1 low-confidence column needs review'
      : `${remaining} of ${total} low-confidence columns still need review`;
  }

  return (
    <p
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
        done
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {label}
    </p>
  );
}
