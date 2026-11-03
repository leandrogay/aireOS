'use client';

import { Fragment } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import ExpandableRow from '@/components/ui/ExpandableRow';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/formatDate';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import {
  promotionRetailerNames,
  promotionStatus,
  promotionStatusLabel,
  promotionStoreNames,
} from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { summariseNames } from '@/app/utils/tableView';
import PromotionDetails from '@/components/promotions/PromotionDetails';

import { PROMOTION_COLUMNS } from './columns';

// promotionStatus() values → StatusPill tones.
const STATUS_TONES = {
  active: 'success',
  upcoming: 'info',
  past: 'muted',
};

/**
 * One promotion: its table row plus, when expanded, its stores, voucher and
 * SKU ranges (PromotionDetails). Edit and Delete live in the "..." menu;
 * Delete only asks for confirmation.
 *
 * @param {{
 *   promotion: object,
 *   isOpen: boolean,
 *   isEditing: boolean,
 *   isNew: boolean,
 *   onToggle: () => void,
 *   onEdit: (promotion: object) => void,
 *   onDelete: (promotion: object) => void,
 * }} props
 */
export default function PromotionRow({
  promotion,
  isOpen,
  isEditing,
  isNew,
  onToggle,
  onEdit,
  onDelete,
}) {
  const retailerNames = promotionRetailerNames(promotion).map(retailerLabel);
  const storeNames = promotionStoreNames(promotion);
  const retailerSummary = summariseNames(retailerNames);
  const status = promotionStatus(promotion);

  const actions = [
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: () => onEdit(promotion),
      disabledReason: isEditing ? 'Editing now' : undefined,
    },
    { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => onDelete(promotion) },
  ];

  return (
    <ExpandableRow
      columnCount={PROMOTION_COLUMNS.length}
      isOpen={isOpen}
      onToggle={onToggle}
      highlight={isEditing ? 'editing' : isNew ? 'new' : null}
      primary={retailerSummary}
      // The retailer is how a row is recognised, so it is never cut off.
      wrapPrimary
      title={retailerNames.join(', ') || undefined}
      toggleLabel={isOpen ? `Hide details for ${retailerSummary}` : `Show details for ${retailerSummary}`}
      actions={<RowActions label={`Actions for promotion ${promotion.promotion_id}`} actions={actions} />}
      details={<PromotionDetails promotion={promotion} />}
    >
      <td className="px-4 py-2.5 font-medium" title={storeNames.join(', ') || undefined}>
        <span className="block truncate">{summariseNames(storeNames)}</span>
      </td>
      <td className="px-4 py-2.5">{formatDate(promotion.period_start)}</td>
      <td className="px-4 py-2.5">{formatDate(promotion.period_end)}</td>
      {/* Multi-week labels ("W20-2025, W21-2025, W22-2025") wrap instead of
          being cut off. Each word is nowrap so lines break only at spaces,
          never after the hyphen in "W21-2025". */}
      <td className="px-4 py-2.5" title={promotion.period_label || undefined}>
        <span className="block whitespace-normal leading-snug">
          {promotion.period_label
            ? promotion.period_label.split(' ').map((word, index) => (
                <Fragment key={index}>
                  {index > 0 && ' '}
                  <span className="whitespace-nowrap">{word}</span>
                </Fragment>
              ))
            : '-'}
        </span>
      </td>
      <td className="truncate px-4 py-2.5">{promoTypeLabel(promotion.promo_type)}</td>
      <td className="px-4 py-2.5" title={promotion.promotion_mechanic || undefined}>
        <span className="block truncate">{promotion.promotion_mechanic || '-'}</span>
      </td>
      <td className="px-4 py-2.5">
        <StatusPill tone={STATUS_TONES[status]}>{promotionStatusLabel(status)}</StatusPill>
      </td>
    </ExpandableRow>
  );
}
