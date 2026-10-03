import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Placeholder `<tr>` rows for a table whose first load is in flight, so the
 * table does not jump from empty to full. Render it inside the real
 * `<tbody>`, under the real header, and only while there is no data yet: on
 * a refresh keep the old rows on screen (RefreshButton shows the reload).
 *
 * `columns` must match the header's column count so the bars line up.
 * `className` goes on every row; pass the real rows' height and border so
 * nothing moves when the data arrives.
 *
 * @param {{
 *   columns: number,
 *   rows?: number,
 *   className?: string,
 * }} props
 */
export default function TableSkeleton({ columns, rows = 6, className }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} aria-hidden="true" className={cn('h-12 border-b border-lavander/80', className)}>
      {Array.from({ length: columns }, (_, cell) => (
        <td key={cell} className="px-4 py-3.5">
          <Skeleton className="h-3.5 w-full max-w-[6rem] rounded bg-lavander" />
        </td>
      ))}
    </tr>
  ));
}
