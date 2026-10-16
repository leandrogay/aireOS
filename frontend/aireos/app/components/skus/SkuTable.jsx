'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';

import DataTable from '@/components/ui/DataTable';
import RowActions from '@/components/ui/RowActions';
import TablePagination from '@/components/ui/TablePagination';

import { SKU_COLUMNS } from './columns';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

export default function SkuTable({
  rows,
  total,
  totalCount,
  loading,
  error,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  onView,
  onEdit,
  onDelete,
  onRefresh,
}) {
  return (
    <DataTable
      label="SKU catalogue"
      noun="SKU"
      plural="SKUs"
      totalCount={totalCount}
      shownCount={total}
      isLoading={loading}
      error={error}
      onRefresh={onRefresh}
      emptyMessage="No active SKUs yet. Use Create SKU to add the first one."
      fill
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
      {rows.map((sku) => {
        const actions = [
          { key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(sku) },
          { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => onEdit(sku) },
          { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => onDelete(sku) },
        ];

        return (
          <tr key={sku.sku} className="h-11 border-b border-lavander/80 last:border-b-0 hover:bg-cream/60">
            <td className="px-4 py-2.5 font-medium">{sku.sku}</td>
            <td className="truncate px-4 py-2.5" title={sku.product_name}>{sku.product_name}</td>
            <td className="truncate px-4 py-2.5" title={sku.sku_range}>{sku.sku_range}</td>
            <td className="px-4 py-2.5">{sku.size}</td>
            <td className="px-4 py-2.5">{sku.brand}</td>
            <td className="px-4 py-2.5">{sku.uom}</td>
            <td className="px-4 py-2.5 tabular-nums">{sku.pack_size}</td>
            <td className="px-4 py-2.5 tabular-nums">{money.format(Number(sku.price))}</td>
            <td className="px-2 py-1 text-right">
              <RowActions label={`Actions for SKU ${sku.sku}`} actions={actions} />
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
