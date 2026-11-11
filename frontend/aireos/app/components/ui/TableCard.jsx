import { cn } from '@/lib/utils';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';

/** Shared card and flush header for list and non-paginated tables. */
export default function TableCard({ label, header, className, variant = 'default', children }) {
  const glass = variant === 'glass';
  return (
    <section
      aria-label={label}
      className={cn(
        'flex w-full min-w-0 flex-col overflow-hidden',
        glass ? glassSurfaceClass : 'aire-glass-surface rounded-lg border border-lavander bg-white shadow-sm',
        className,
      )}
    >
      {header ? <div className={cn('px-4 py-3', glass ? 'bg-card/45' : 'bg-white')}>{header}</div> : null}
      {children}
    </section>
  );
}
