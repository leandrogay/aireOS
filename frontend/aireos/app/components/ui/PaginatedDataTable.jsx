'use client';

import DataTable from '@/components/ui/DataTable';
import TablePagination from '@/components/ui/TablePagination';

/** The shared list table with its standard pagination footer. */
export default function PaginatedDataTable({ pagination, ...props }) {
  return <DataTable {...props} footer={<TablePagination {...pagination} />} />;
}
