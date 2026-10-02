import { cn } from '@/lib/utils';

/**
 * Compact last-updated stamps. Pass already-formatted `{ label, value }` items.
 */
export default function LastUpdatedStamp({ items = [], className }) {
  if (!items.length) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] text-deep-violet-blue',
        className
      )}
    >
      <span className="font-semibold uppercase tracking-wide text-deep-violet-blue/45">
        Last updated
      </span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <span className="text-deep-violet-blue/45">{item.label}</span>
          <span className="font-medium">{item.value || '—'}</span>
        </span>
      ))}
    </div>
  );
}
