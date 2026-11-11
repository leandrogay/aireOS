'use client';

import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import TableSearch from '@/components/ui/TableSearch';
import SkuRow from '@/components/skus/SkuRow';
import { formatSkuPrice, skuRowActions } from '@/components/skus/SkuRow';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
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
    <PaginatedDataTable
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
      pagination={{ page, totalPages, pageSize, totalRows: total, onPageChange, onPageSizeChange }}
      columns={SKU_COLUMNS}
      emptyState={!loading && totalCount > 0 && total === 0 ? 'No SKUs match the current search and filters.' : null}
      mobileContent={
        <RecordCardList>
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
        </RecordCardList>
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
    </PaginatedDataTable>
  );
}
