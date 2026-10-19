import { RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Put something back as the AI proposed it. Shown only once the reviewer has
 * changed it -- a reset that does nothing is noise -- with the same icon and
 * look everywhere on the review: a field, a product code, the retailer, a
 * whole step. `compact` drops the word for a tight table cell; the aria-label
 * and tooltip still say what is reset.
 *
 * @param {{
 *   label: string,
 *   onClick: () => void,
 *   text?: string,
 *   compact?: boolean,
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 */
export default function ResetButton({ label, onClick, text = 'Reset', compact = false, disabled = false, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-deep-violet-blue/70 transition hover:bg-cream hover:text-deep-violet-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60',
        className,
      )}
    >
      <RotateCcw aria-hidden="true" className="size-3" />
      {!compact && text}
    </button>
  );
}
