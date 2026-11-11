'use client';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import TableGrid from '@/components/ui/TableGrid';
import TableCard from '@/components/ui/TableCard';
import { cn } from '@/lib/utils';
import { resultCountLabel } from '@/app/utils/tableView';
import useMediaQuery from '@/hooks/useMediaQuery';

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
 * `title` shows a heading before the count, for a list that shares its page
 * with other sections (Recent uploads under the upload area). Leave it out
 * when the page title already names the list.
 *
 * @param {{
 *   label: string,
 *   title?: string,
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
 *   mobileContent?: import('react').ReactNode,
 * } & Omit<Parameters<typeof TableGrid>[0], 'variant' | 'isLoading'>} props
 */
export default function DataTable({
  label,
  title = null,
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
  mobileContent = null,
  ...gridProps
}) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const showMobile = Boolean(mobileContent) && mobile;
  const firstLoad = isLoading && totalCount === 0;
  const showTable = firstLoad || totalCount > 0;

  return (
    // No visible heading unless `title` is given (the page title usually
    // names the list); the aria-label still names the region for screen
    // readers.
    <TableCard
      label={label}
      // min-h-80 keeps the table usable on a short window.
      className={fill ? 'min-h-80 flex-1' : undefined}
      header={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            {title && <h2 className="font-serif text-xl text-deep-violet-blue">{title}</h2>}
            <p className="text-sm text-deep-violet-blue/70" aria-live="polite">
              {firstLoad ? `Loading ${plural}…` : resultCountLabel(shownCount, totalCount, noun, plural)}
            </p>
          </div>
          <div className={cn('flex min-w-0 flex-wrap items-center gap-2', toolbar ? 'w-full sm:w-auto' : 'ml-auto')}>
            {toolbar}
            <RefreshButton
              onClick={onRefresh}
              isRefreshing={isLoading}
              label={`Refresh ${plural}`}
              className="rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
            />
          </div>
        </div>
      )}
    >
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
          {showMobile && (
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-lavander bg-cream/25 p-3">
              {firstLoad ? (
                <div className="grid gap-2" aria-label={`Loading ${plural}`}>
                  {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-lavander bg-white" />)}
                </div>
              ) : gridProps.emptyState ? (
                <div className="rounded-lg border border-lavander bg-white p-6 text-center text-sm text-deep-violet-blue/70">{gridProps.emptyState}</div>
              ) : mobileContent}
            </div>
          )}
          {!showMobile && (
            <div className="flex min-h-0 flex-1">
              <TableGrid variant="card" isLoading={firstLoad} {...gridProps} />
            </div>
          )}
          {footer}
        </>
      )}
    </TableCard>
  );
}
