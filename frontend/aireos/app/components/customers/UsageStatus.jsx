import { cn } from '@/lib/utils';

// Same soft pills as the promotions list (PromotionRow StatusPill): green for
// a record that already has data, muted for one that has none yet. The dot
// and the word carry the meaning, so it never rests on colour alone.
const STYLES = {
  inUse: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  unused: 'border-lavander bg-cream text-deep-violet-blue/70',
};

/**
 * "In use" once a customer or retailer has data (it can then no longer be
 * renamed or deleted), "Unused" before.
 *
 * @param {{ inUse: boolean }} props
 */
export default function UsageStatus({ inUse }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        inUse ? STYLES.inUse : STYLES.unused,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {inUse ? 'In use' : 'Unused'}
    </span>
  );
}
