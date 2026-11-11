'use client';

import DataTable from '@/components/ui/DataTable';
import TablePagination from '@/components/ui/TablePagination';

/**
 * The shared list table with its standard pagination footer. The page number
 * is the table's `pageKey`, so each new page's rows cascade in.
 */
export default function PaginatedDataTable({ pagination, ...props }) {
  return <DataTable {...props} pageKey={pagination.page} footer={<TablePagination {...pagination} />} />;
}
