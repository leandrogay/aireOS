'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

/**
 * One SKU catalogue row. Details remain in the existing dialog, while the
 * standard row-actions menu keeps View, Edit and Delete consistent with the
 * Customers and Promotions lists.
 *
 * @param {{
 *   sku: object,
 *   onView: (sku: object) => void,
 *   onEdit: (sku: object) => void,
 *   onDelete: (sku: object) => void,
 * }} props
 */
export default function SkuRow({ sku, onView, onEdit, onDelete }) {
  const actions = [
    { key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(sku) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => onEdit(sku) },
    { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => onDelete(sku) },
  ];

  return (
    <tr className="h-11 border-b border-lavander/80 last:border-b-0 hover:bg-cream/60">
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
}
