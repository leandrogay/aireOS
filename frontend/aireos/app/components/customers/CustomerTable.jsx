'use client';

import DataTable from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RowActions from '@/components/ui/RowActions';
import UsageStatus from './UsageStatus';
import { retailerLabel } from '@/app/utils/retailerLabel';

import { CUSTOMER_COLUMNS } from './columns';
import CustomerRow, { customerRowActions, retailerRowActions } from './CustomerRow';

/**
 * The customer list: the shared list-table card (count, refresh, retry,
 * placeholder rows, empty state) with one expandable row per customer.
 *
 * @param {{
 *   customers: object[],
 *   loading: boolean,
 *   error: string | null,
 *   isExpanded: (customerId: number) => boolean,
 *   highlightId: number | null,
 *   onToggle: (customerId: number) => void,
 *   onRefresh: () => void,
 * } & Omit<Parameters<typeof CustomerRow>[0], 'customer' | 'isOpen' | 'isNew' | 'onToggle'>} props
 */
export default function CustomerTable({
  customers,
  loading,
  error,
  isExpanded,
  highlightId,
  onToggle,
  onRefresh,
  ...rowHandlers
}) {
  return (
    <DataTable
      label="Customers"
      noun="customer"
      totalCount={customers.length}
      isLoading={loading}
      error={error}
      onRefresh={onRefresh}
      emptyMessage="No customers yet. Use Add customer to create the first one."
      columns={CUSTOMER_COLUMNS}
      minWidth="26rem"
      skeletonRows={4}
      mobileContent={
        <div className="grid gap-2">
          {customers.map((customer) => {
            const name = retailerLabel(customer.customer_name);
            const open = isExpanded(customer.customer_id);
            return (
              <MobileRecordCard
                key={customer.customer_id}
                title={name}
                badge={<UsageStatus inUse={customer.in_use} />}
                actions={<RowActions label={`Actions for customer ${name}`} actions={customerRowActions(customer, rowHandlers.onEdit, rowHandlers.onDelete, rowHandlers.onAddRetailer)} />}
              >
                <Button variant="link" size="sm" aria-expanded={open} onClick={() => onToggle(customer.customer_id)} className="mt-2 h-auto px-0 text-xs text-deep-violet-blue">
                  {open ? 'Hide retailers' : `View retailers (${customer.retailers.length})`}
                </Button>
                {open && (
                  <div className="mt-2 divide-y divide-lavander/70 border-t border-lavander/70">
                    {customer.retailers.map((retailer) => (
                      <div key={retailer.retailer_id} className="flex items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 break-words text-xs text-deep-violet-blue">
                          {retailerLabel(retailer.retailer_name)}
                          <span className="ml-1 text-deep-violet-blue/60">· {retailer.store_count} stores</span>
                        </span>
                        <RowActions label={`Actions for retailer ${retailer.retailer_name}`} actions={retailerRowActions(retailer, customer, rowHandlers.onEditRetailer, rowHandlers.onDeleteRetailer)} />
                      </div>
                    ))}
                    {customer.retailers.length === 0 && <p className="py-2 text-xs text-deep-violet-blue/60">No retailers yet.</p>}
                    <Button variant="link" size="sm" onClick={() => rowHandlers.onAddRetailer(customer)} className="h-auto px-0 py-2 text-xs text-deep-violet-blue">Add retailer</Button>
                  </div>
                )}
              </MobileRecordCard>
            );
          })}
        </div>
      }
    >
      {customers.map((customer) => (
        <CustomerRow
          key={customer.customer_id}
          customer={customer}
          isOpen={isExpanded(customer.customer_id)}
          isNew={highlightId === customer.customer_id}
          onToggle={() => onToggle(customer.customer_id)}
          {...rowHandlers}
        />
      ))}
    </DataTable>
  );
}
