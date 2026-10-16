'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import TablePagination from '@/components/ui/TablePagination';
import TableSkeleton from '@/components/ui/TableSkeleton';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const header = 'px-3 py-2.5 text-xs font-medium text-deep-violet-blue/70';

export default function SkuTable({
  rows,
  total,
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
}) {
  return (
    <section aria-label="SKU catalogue" className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm">
      <div className="px-4 py-3 text-sm text-deep-violet-blue/70" aria-live="polite">
        {loading ? 'Loading SKUs…' : `${total} active ${total === 1 ? 'SKU' : 'SKUs'}`}
      </div>
      {error && <p className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto border-t border-lavander">
        <table className="w-full whitespace-nowrap text-left text-sm text-deep-violet-blue">
          <thead className="sticky top-0 z-10 bg-cream">
            <tr>
              {['SKU', 'Product', 'Range', 'Size', 'Brand', 'UOM', 'Pack size', 'Price'].map((label) => (
                <th key={label} scope="col" className={header}>{label}</th>
              ))}
              <th scope="col" className="w-px px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lavander/70">
            {loading && <TableSkeleton columns={9} />}
            {!loading && !rows.length && (
              <tr><td colSpan={9} className="px-4 py-20 text-center text-deep-violet-blue/70">No SKUs match the current search and filters.</td></tr>
            )}
            {!loading && rows.map((sku) => (
              <tr key={sku.sku} className="hover:bg-cream/60">
                <td className="px-3 py-2.5 font-medium">{sku.sku}</td>
                <td className="max-w-64 truncate px-3 py-2.5" title={sku.product_name}>{sku.product_name}</td>
                <td className="max-w-52 truncate px-3 py-2.5" title={sku.sku_range}>{sku.sku_range}</td>
                <td className="px-3 py-2.5">{sku.size}</td>
                <td className="px-3 py-2.5">{sku.brand}</td>
                <td className="px-3 py-2.5">{sku.uom}</td>
                <td className="px-3 py-2.5 tabular-nums">{sku.pack_size}</td>
                <td className="px-3 py-2.5 tabular-nums">{money.format(Number(sku.price))}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`View ${sku.sku}`} onClick={() => onView(sku)}><Eye /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${sku.sku}`} onClick={() => onEdit(sku)}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${sku.sku}`} onClick={() => onDelete(sku)}><Trash2 /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalRows={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </section>
  );
}
