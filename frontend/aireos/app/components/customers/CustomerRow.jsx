'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import ExpandableRow from '@/components/ui/ExpandableRow';
import RowActions from '@/components/ui/RowActions';
import { EXPANDED_ROW_INSET } from '@/components/ui/TableGrid';
import { customerLabel } from '@/app/utils/retailerLabel';
import { customerDeleteBlockReason, retailerBlockReason } from '@/app/utils/customerForm';

import { CUSTOMER_COLUMNS } from './columns';
import RetailerTable from './RetailerTable';
import UsageStatus from './UsageStatus';

/**
 * One customer: its table row plus, when expanded, its retailers and an
 * "Add retailer" button.
 *
 * @param {{
 *   customer: object,
 *   isOpen: boolean,
 *   isNew: boolean,
 *   onToggle: () => void,
 *   onEdit: (customer: object) => void,
 *   onDelete: (customer: object) => void,
 *   onAddRetailer: (customer: object) => void,
 *   onEditRetailer: (retailer: object, customer: object) => void,
 *   onDeleteRetailer: (retailer: object, customer: object) => void,
 * }} props
 */
export function customerRowActions(customer, onEdit, onDelete, onAddRetailer) {
  return [
    {
      key: 'edit',
      label: 'Edit name',
      icon: Pencil,
      onSelect: () => onEdit(customer),
    },
    { key: 'add-retailer', label: 'Add retailer', icon: Plus, onSelect: () => onAddRetailer(customer) },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => onDelete(customer),
      disabledReason: customerDeleteBlockReason(customer),
    },
  ];
}

export function retailerRowActions(retailer, customer, onEditRetailer, onDeleteRetailer) {
  const blocked = retailerBlockReason(retailer);
  return [
    { key: 'edit', label: 'Edit name', icon: Pencil, onSelect: () => onEditRetailer(retailer, customer), disabledReason: blocked },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => onDeleteRetailer(retailer, customer),
      disabledReason: blocked,
    },
  ];
}

export default function CustomerRow({
  customer,
  isOpen,
  isNew,
  onToggle,
  onEdit,
  onDelete,
  onAddRetailer,
  onEditRetailer,
  onDeleteRetailer,
}) {
  const name = customerLabel(customer.customer_name);

  const customerActions = customerRowActions(customer, onEdit, onDelete, onAddRetailer);

  const retailerActions = (retailer) => retailerRowActions(retailer, customer, onEditRetailer, onDeleteRetailer);

  return (
    <ExpandableRow
      columnCount={CUSTOMER_COLUMNS.length}
      isOpen={isOpen}
      onToggle={onToggle}
      highlight={isNew ? 'new' : null}
      primary={name}
      title={name}
      toggleLabel={isOpen ? `Hide retailers for ${name}` : `Show retailers for ${name}`}
      actions={<RowActions label={`Actions for customer ${name}`} actions={customerActions} />}
      details={
        <div className="grid gap-2">
          {customer.retailers.length > 0 ? (
            <RetailerTable retailers={customer.retailers} inset={EXPANDED_ROW_INSET} actionsFor={retailerActions} />
          ) : (
            <p className="text-sm text-deep-violet-blue/70">{name} has no retailers yet.</p>
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddRetailer(customer)}
              className="border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
            >
              <Plus data-icon="inline-start" />
              Add retailer
            </Button>
          </div>
        </div>
      }
    >
      <td className="px-4 py-2.5">
        <UsageStatus inUse={customer.in_use} />
      </td>
    </ExpandableRow>
  );
}
