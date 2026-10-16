'use client';

import DataTable from '@/components/ui/DataTable';

import { CUSTOMER_COLUMNS } from './columns';
import CustomerRow from './CustomerRow';

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
      minWidth="40rem"
      skeletonRows={4}
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
