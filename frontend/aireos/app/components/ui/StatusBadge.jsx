import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CopyCheck,
  Loader2,
  CircleDashed,
} from 'lucide-react';

// A status label that always says what it means.
//
// Colour is a second channel here, never the only one: every badge carries an
// icon and a word, so the difference between "ready" and "rejected" survives
// greyscale, colour blindness, and a glance at the wrong angle.
const TONES = {
  ready: { className: 'border-green-300 bg-green-50 text-green-800', Icon: CheckCircle2 },
  failed: { className: 'border-red-300 bg-red-50 text-red-800', Icon: XCircle },
  review: { className: 'border-amber-400 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  duplicate: { className: 'border-yellow-400 bg-yellow-50 text-yellow-900', Icon: CopyCheck },
  busy: { className: 'border-violet bg-lavander text-deep-violet-blue', Icon: Loader2 },
  neutral: { className: 'border-lavander bg-cream text-deep-violet-blue', Icon: CircleDashed },
};

/**
 * @param {{ tone?: keyof typeof TONES, children: import('react').ReactNode }} props
 */
export default function StatusBadge({ tone = 'neutral', children }) {
  const { className, Icon } = TONES[tone] || TONES.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 ${tone === 'busy' ? 'animate-spin' : ''}`}
      />
      {children}
    </span>
  );
}
