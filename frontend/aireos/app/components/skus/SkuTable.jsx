'use client';

import DataTable from '@/components/ui/DataTable';
import TablePagination from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import SkuRow from '@/components/skus/SkuRow';

import { SKU_COLUMNS } from './columns';

export default function SkuTable({
  rows,
  total,
  totalCount,
  search,
  loading,
  error,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  onHistory,
  onEdit,
  onDelete,
  onRefresh,
  onSearch,
}) {
  return (
    <DataTable
      label="SKU catalog"
      noun="SKU"
      plural="SKUs"
      totalCount={totalCount}
      shownCount={total}
      isLoading={loading}
      error={error}
      onRefresh={onRefresh}
      emptyMessage="No active SKUs yet. Use Create SKU to add the first one."
      fill
      toolbar={
        <TableSearch
          value={search}
          onChange={onSearch}
          label="Search SKUs"
          placeholder="Search SKU, range or product…"
        />
      }
      footer={
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      }
      columns={SKU_COLUMNS}
      minWidth="72rem"
      emptyState={!loading && totalCount > 0 && total === 0 ? 'No SKUs match the current search and filters.' : null}
    >
      {rows.map((sku) => (
        <SkuRow
          key={sku.sku}
          sku={sku}
          onHistory={onHistory}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </DataTable>
  );
}
