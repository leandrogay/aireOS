'use client';

import { Fragment } from 'react';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { summariseNames } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  customerDeleteBlockReason,
  customerEditBlockReason,
  retailerBlockReason,
} from '@/app/utils/customerForm';

import RetailerTable from './RetailerTable';
import RowActions from './RowActions';
import UsageStatus from './UsageStatus';

/**
 * One customer: its table row plus, when expanded, its retailers and an
 * "Add retailer" button. Clicking the row toggles it, as in the promotions
 * list (PromotionRow); the chevron button is the keyboard route.
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
  const name = retailerLabel(customer.customer_name);
  const retailerNames = customer.retailers.map((retailer) => retailerLabel(retailer.retailer_name));

  const customerActions = [
    {
      key: 'edit',
      label: 'Edit name',
      icon: Pencil,
      onSelect: () => onEdit(customer),
      disabledReason: customerEditBlockReason(customer),
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

  const retailerActions = (retailer) => {
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
  };

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={cn(
          'h-12 cursor-pointer border-b border-lavander/80 transition-colors',
          isNew ? 'bg-lavander/70' : isOpen ? 'bg-cream/80' : 'bg-white hover:bg-cream/50',
        )}
      >
        <td className="px-4 py-2.5 font-medium">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Hide retailers for ${name}` : `Show retailers for ${name}`}
            onClick={(event) => {
              // The row's own onClick toggles too; one toggle per click.
              event.stopPropagation();
              onToggle();
            }}
            className="inline-flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('size-4 shrink-0 text-deep-violet-blue/50 transition-transform', isOpen && 'rotate-90')}
            />
            {name}
          </button>
        </td>
        <td className="px-4 py-2.5" title={retailerNames.join(', ') || undefined}>
          <span className={cn('block max-w-[18rem] truncate', !retailerNames.length && 'text-deep-violet-blue/50')}>
            {summariseNames(retailerNames, 'None yet')}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <UsageStatus inUse={customer.in_use} />
        </td>
        {/* React events bubble through portals, so without this a click on a
            menu item would also reach the row's toggle. */}
        <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
          <RowActions label={`Actions for customer ${name}`} actions={customerActions} />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-lavander/80">
          <td colSpan={4} className="whitespace-normal bg-cream/50 px-4 py-3">
            <div className="grid gap-2">
              {customer.retailers.length > 0 ? (
                <RetailerTable retailers={customer.retailers} actionsFor={retailerActions} />
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
          </td>
        </tr>
      )}
    </Fragment>
  );
}
