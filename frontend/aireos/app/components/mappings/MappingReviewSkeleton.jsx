import { Skeleton } from '@/components/ui/skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';

// Matches the header row of the column-mapping table in MappingReviewPanel.
const COLUMN_HEADERS = ['Source column', 'Sample values', 'Becomes', 'Confidence', 'Review'];

/**
 * Placeholder for MappingReviewPanel while GET /api/mappings/{id} is in
 * flight: the header card and the column-mapping table, in the same cards the
 * panel renders, so the page does not jump when the mapping arrives.
 */
export default function MappingReviewSkeleton() {
  return (
    <div role="status" className="space-y-1">
      <span className="sr-only">Loading mapping…</span>

      <section
        aria-hidden="true"
        className="rounded-lg border border-lavander bg-white p-6 shadow-sm"
      >
        <Skeleton className="h-5 w-32 rounded-full bg-lavander" />
        <Skeleton className="mt-3 h-6 w-64 rounded bg-lavander" />
        <Skeleton className="mt-2 h-4 w-48 rounded bg-lavander" />
      </section>

      <section
        aria-hidden="true"
        className="rounded-lg border border-lavander bg-white p-6 shadow-sm"
      >
        <div className="mb-3">
          <h3 className="font-serif text-lg text-deep-violet-blue">Column mapping</h3>
          <p className="text-xs text-deep-violet-blue/70">
            Least certain first — those are the ones worth your time.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-lavander">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-lavander text-deep-violet-blue">
              <tr>
                {COLUMN_HEADERS.map((header) => (
                  <th key={header} className="px-3 py-2 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableSkeleton columns={COLUMN_HEADERS.length} cellClassName="px-3 py-2" />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
