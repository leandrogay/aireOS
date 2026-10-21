'use client';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import TableGrid from '@/components/ui/TableGrid';
import { cn } from '@/lib/utils';
import { resultCountLabel } from '@/app/utils/tableView';

/**
 * The list-table card every feature uses (Customers, Promotions): a count on
 * the left; `toolbar` (e.g. TableSearch) and Refresh on the right; then the
 * table (TableGrid, which takes `columns` and the rest of the props); then
 * `footer` (e.g. TablePagination).
 *
 *   <DataTable
 *     label="Customers"
 *     noun="customer"
 *     totalCount={customers.length}
 *     isLoading={loading}
 *     error={error}
 *     onRefresh={refresh}
 *     emptyMessage="No customers yet. Use Add customer to create the first one."
 *     columns={CUSTOMER_COLUMNS}
 *     minWidth="40rem"
 *   >
 *     {customers.map((customer) => <CustomerRow key={…} … />)}
 *   </DataTable>
 *
 * States: placeholder rows on the first load (`isLoading` with nothing
 * loaded yet; on a refresh the old rows stay and Refresh spins); an error
 * box with Retry (calls `onRefresh`), with any loaded rows left under it;
 * `emptyMessage` when there is nothing to list at all. The count reads
 * "12 of 70 promotions" when `shownCount` (after filters / search) is less
 * than `totalCount`.
 *
 * `fill` makes the card take the height its flex parent gives it (PageLayout
 * fitScreen) with the rows scrolling inside, so searching or paging never
 * resizes it.
 *
 * @param {{
 *   label: string,
 *   noun: string,
 *   plural?: string,
 *   totalCount: number,
 *   shownCount?: number,
 *   isLoading?: boolean,
 *   error?: string | null,
 *   onRefresh: () => void,
 *   emptyMessage: import('react').ReactNode,
 *   toolbar?: import('react').ReactNode,
 *   footer?: import('react').ReactNode,
 *   fill?: boolean,
 * } & Omit<Parameters<typeof TableGrid>[0], 'variant' | 'isLoading'>} props
 */
export default function DataTable({
  label,
  noun,
  plural = `${noun}s`,
  totalCount,
  shownCount = totalCount,
  isLoading = false,
  error = null,
  onRefresh,
  emptyMessage,
  toolbar = null,
  footer = null,
  fill = false,
  ...gridProps
}) {
  const firstLoad = isLoading && totalCount === 0;
  const showTable = firstLoad || totalCount > 0;

  return (
    // No visible heading (the page title already names the list); the
    // aria-label still names the region for screen readers.
    <section
      aria-label={label}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm',
        // min-h-80 keeps the table usable on a short window (the page
        // scrolls instead).
        fill && 'min-h-80 flex-1',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-deep-violet-blue/70" aria-live="polite">
          {firstLoad ? `Loading ${plural}…` : resultCountLabel(shownCount, totalCount, noun, plural)}
        </p>
        <div className="flex items-center gap-2">
          {toolbar}
          <RefreshButton
            onClick={onRefresh}
            isRefreshing={isLoading}
            label={`Refresh ${plural}`}
            className="rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="border-red-200 bg-white text-red-700 hover:bg-red-50"
          >
            {isLoading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {!error && !showTable && <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">{emptyMessage}</p>}

      {showTable && (
        <>
          <TableGrid variant="card" isLoading={firstLoad} {...gridProps} />
          {footer}
        </>
      )}
    </section>
  );
}
