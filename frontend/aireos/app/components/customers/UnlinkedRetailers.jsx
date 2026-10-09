'use client';

import { Link2, Pencil, Trash2 } from 'lucide-react';

import { cardClass } from '@/components/inventory/formStyles';
import { retailerBlockReason } from '@/app/utils/customerForm';

import RetailerTable from './RetailerTable';

/**
 * Retailers that no customer owns yet. Every retailer should belong to a
 * customer, but promotions and uploads create retailers by name
 * (get_or_create_retailers) without one, so they are listed here to be
 * linked. Hidden when there are none.
 *
 * @param {{
 *   retailers: object[],
 *   onLink: (retailer: object) => void,
 *   onEdit: (retailer: object) => void,
 *   onDelete: (retailer: object) => void,
 * }} props
 */
export default function UnlinkedRetailers({ retailers, onLink, onEdit, onDelete }) {
  if (!retailers.length) return null;

  const actionsFor = (retailer) => {
    const blocked = retailerBlockReason(retailer);
    return [
      { key: 'link', label: 'Link to customer', icon: Link2, onSelect: () => onLink(retailer) },
      { key: 'edit', label: 'Edit name', icon: Pencil, onSelect: () => onEdit(retailer), disabledReason: blocked },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        destructive: true,
        onSelect: () => onDelete(retailer),
        disabledReason: blocked,
      },
    ];
  };

  return (
    <section aria-labelledby="unlinked-retailers-title" className={cardClass}>
      <h2 id="unlinked-retailers-title" className="text-sm font-medium text-deep-violet-blue">
        Retailers without a customer
      </h2>
      <p className="mb-2 mt-0.5 text-xs text-deep-violet-blue/70">
        Every retailer should belong to a customer. Link each one below to its customer.
      </p>
      <RetailerTable retailers={retailers} actionsFor={actionsFor} />
    </section>
  );
}
