import { cn } from '@/lib/utils';

// Soft pills that sit with the cream / lavender page. The dot repeats the
// word's meaning in a shape, so a status never rests on colour alone.
const TONES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-violet/40 bg-lavander text-deep-violet-blue',
  muted: 'border-lavander bg-cream text-deep-violet-blue/70',
};

/**
 * A record's status in a list table's Status column: "Active", "Upcoming",
 * "In use". Each feature maps its own states to a tone. (StatusBadge, with an
 * icon per tone, is for upload / processing states.)
 *
 * @param {{ tone?: keyof typeof TONES, children: import('react').ReactNode }} props
 */
export default function StatusPill({ tone = 'muted', children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[tone] || TONES.muted,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
