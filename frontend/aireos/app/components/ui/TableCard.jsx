import { cn } from '@/lib/utils';

/** Shared card and flush header for list and non-paginated tables. */
export default function TableCard({ label, header, className, children }) {
  return (
    <section
      aria-label={label}
      className={cn('flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm', className)}
    >
      {header ? <div className="bg-white px-4 py-3">{header}</div> : null}
      {children}
    </section>
  );
}
