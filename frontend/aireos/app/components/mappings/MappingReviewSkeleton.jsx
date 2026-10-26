import { Skeleton } from '@/components/ui/skeleton';

const card = 'rounded-lg border border-lavander bg-white p-3 shadow-sm';
const bar = 'rounded bg-lavander';

/**
 * Placeholder for MappingReviewPanel while GET /api/mappings/{id} is in
 * flight: the header, the first two steps and the "What's left" list, in the
 * same cards and grid the panel renders, so the page does not jump when the
 * mapping arrives.
 */
export default function MappingReviewSkeleton() {
  return (
    <div role="status" className="space-y-1">
      <span className="sr-only">Loading mapping…</span>

      <section aria-hidden="true" className={card}>
        <Skeleton className="h-5 w-36 rounded-full bg-lavander" />
        <Skeleton className={`mt-2 h-4 w-64 ${bar}`} />
        <Skeleton className={`mt-2 h-4 w-full max-w-xl ${bar}`} />
      </section>

      <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="space-y-1">
          {[3, 8].map((lines, index) => (
            <section key={index} aria-hidden="true" className={card}>
              <div className="mb-3 flex items-center gap-2.5">
                <Skeleton className="size-6 rounded-full bg-lavander" />
                <Skeleton className={`h-4 w-48 ${bar}`} />
              </div>
              {Array.from({ length: lines }, (_, line) => (
                <Skeleton key={line} className={`mt-2 h-8 w-full ${bar}`} />
              ))}
            </section>
          ))}
        </div>

        <aside aria-hidden="true" className={card}>
          <Skeleton className={`h-4 w-24 ${bar}`} />
          {Array.from({ length: 6 }, (_, line) => (
            <Skeleton key={line} className={`mt-3 h-3.5 w-full ${bar}`} />
          ))}
          <Skeleton className={`mt-4 h-8 w-full ${bar}`} />
        </aside>
      </div>
    </div>
  );
}
