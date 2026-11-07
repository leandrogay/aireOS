'use client';

import DataTable from '@/components/ui/DataTable';
import TablePagination from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import SkuRow from '@/components/skus/SkuRow';
import { formatSkuPrice, skuRowActions } from '@/components/skus/SkuRow';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RowActions from '@/components/ui/RowActions';

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
      mobileContent={
        <div className="grid gap-2">
          {rows.map((sku) => (
            <MobileRecordCard
              key={sku.sku}
              title={sku.product_name}
              subtitle={`SKU ${sku.sku}`}
              actions={<RowActions label={`Actions for SKU ${sku.sku}`} actions={skuRowActions(sku, onHistory, onEdit, onDelete)} />}
              fields={[
                { label: 'Range', value: sku.sku_range },
                { label: 'Size', value: sku.size },
                { label: 'Brand', value: sku.brand },
                { label: 'Pack', value: `${sku.pack_size} ${sku.uom || ''}`.trim() },
                { label: 'Price', value: formatSkuPrice(sku.price) },
              ]}
            />
          ))}
        </div>
      }
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
