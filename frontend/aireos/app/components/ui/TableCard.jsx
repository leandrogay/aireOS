import { cn } from '@/lib/utils';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';

/** Shared card and flush header for list and non-paginated tables. */
export default function TableCard({ label, header, className, children }) {
  return (
    <section
      aria-label={label}
      className={cn(glassSurfaceClass, 'flex w-full min-w-0 flex-col overflow-hidden', className)}
    >
      {header ? <div className="bg-card/45 px-4 py-3">{header}</div> : null}
      {children}
    </section>
  );
}
