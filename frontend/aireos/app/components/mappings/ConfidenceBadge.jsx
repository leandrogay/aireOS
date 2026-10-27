import { CONFIDENCE_LABELS } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

// How sure the AI was about one field (CONFIDENCE_LABELS), as words and a
// coloured dot -- the words carry the meaning, the colour only helps it stand
// out. A field the reviewer chose is theirs, not the AI's, and says so.
const LEVELS = {
  high: { label: CONFIDENCE_LABELS.high, dot: 'bg-green-600', tone: 'border-green-200 bg-green-50 text-green-800' },
  medium: { label: CONFIDENCE_LABELS.medium, dot: 'bg-amber-400', tone: 'border-amber-200 bg-amber-50/60 text-amber-900' },
  low: { label: CONFIDENCE_LABELS.low, dot: 'bg-amber-600', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  reviewer: { label: 'Your choice', dot: 'bg-deep-violet-blue', tone: 'border-violet bg-lavander/60 text-deep-violet-blue' },
};

/** The badge level for a coverage entry: the AI's confidence, or the reviewer's own choice. */
export function confidenceLevel(entry) {
  if (entry.rationale === 'Chosen by the reviewer.') return 'reviewer';
  return LEVELS[entry.confidence] ? entry.confidence : 'high';
}

/**
 * @param {{ level: 'high' | 'medium' | 'low' | 'reviewer', className?: string }} props
 */
export default function ConfidenceBadge({ level, className }) {
  const { label, dot, tone } = LEVELS[level] || LEVELS.high;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-medium',
        tone,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}
