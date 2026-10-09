'use client';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { TABLE_HEADER_CLASS as headerClass } from '@/components/ui/SortHeader';
import { resultCountLabel } from '@/app/utils/tableView';

import CustomerRow from './CustomerRow';

/**
 * The customer list in the promotions table's look: a count and refresh on
 * top, then one expandable row per customer. Placeholder rows on the first
 * load, an error box with Retry when the list cannot be fetched (rows already
 * on screen stay under it), and an empty state when there are no customers.
 *
 * @param {{
 *   customers: object[],
 *   loading: boolean,
 *   error: string | null,
 *   expandedIds: Set<number>,
 *   highlightId: number | null,
 *   onToggle: (customerId: number) => void,
 *   onRefresh: () => void,
 * } & Omit<Parameters<typeof CustomerRow>[0], 'customer' | 'isOpen' | 'isNew' | 'onToggle'>} props
 */
export default function CustomerTable({
  customers,
  loading,
  error,
  expandedIds,
  highlightId,
  onToggle,
  onRefresh,
  ...rowHandlers
}) {
  const firstLoad = loading && customers.length === 0;
  const showTable = firstLoad || customers.length > 0;

  return (
    <section
      aria-label="Customers"
      className="overflow-hidden rounded-lg border border-lavander bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-deep-violet-blue/70" aria-live="polite">
          {firstLoad ? 'Loading customers…' : resultCountLabel(customers.length, customers.length, 'customer')}
        </p>
        <RefreshButton
          onClick={onRefresh}
          isRefreshing={loading}
          label="Refresh customers"
          className="rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
        />
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
            disabled={loading}
            className="border-red-200 bg-white text-red-700 hover:bg-red-50"
          >
            {loading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {!error && !showTable && (
        <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">
          No customers yet. Use Add customer to create the first one.
        </p>
      )}

      {showTable && (
        <div className="relative overflow-x-auto border-t border-lavander">
          <table className="w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
            <thead>
              <tr className="h-10 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
                <th scope="col" className={headerClass}>Customer</th>
                <th scope="col" className={headerClass}>Retailers</th>
                <th scope="col" className={headerClass}>Status</th>
                <th scope="col" className="w-px px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody aria-busy={firstLoad}>
              {firstLoad && <TableSkeleton columns={4} rows={4} />}
              {customers.map((customer) => (
                <CustomerRow
                  key={customer.customer_id}
                  customer={customer}
                  isOpen={expandedIds.has(customer.customer_id)}
                  isNew={highlightId === customer.customer_id}
                  onToggle={() => onToggle(customer.customer_id)}
                  {...rowHandlers}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
