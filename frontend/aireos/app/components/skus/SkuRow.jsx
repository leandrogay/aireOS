'use client';

import { History, Pencil, Trash2 } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import { cn } from '@/lib/utils';

import { SKU_CELL_CLASS } from './columns';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

/**
 * One SKU catalog row. History remains in a dialog, while the standard
 * row-actions menu keeps History, Edit and Delete consistent with the
 * Customers and Promotions lists.
 *
 * @param {{
 *   sku: object,
 *   onHistory: (sku: object) => void,
 *   onEdit: (sku: object) => void,
 *   onDelete: (sku: object) => void,
 * }} props
 */
export default function SkuRow({ sku, onHistory, onEdit, onDelete }) {
  const actions = [
    { key: 'history', label: 'History', icon: History, onSelect: () => onHistory(sku) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => onEdit(sku) },
    { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => onDelete(sku) },
  ];

  return (
    <tr className="h-11 border-b border-lavander/80 last:border-b-0 hover:bg-cream/60">
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5 font-medium')}>{sku.sku}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5')}>{sku.product_name}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5')}>{sku.sku_range}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5')}>{sku.size}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5')}>{sku.brand}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5')}>{sku.uom}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5 text-right tabular-nums')}>{sku.pack_size}</td>
      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2.5 text-right tabular-nums')}>{money.format(Number(sku.price))}</td>
      <td className="px-2 py-1 text-right">
        <RowActions label={`Actions for SKU ${sku.sku}`} actions={actions} />
      </td>
    </tr>
  );
}
