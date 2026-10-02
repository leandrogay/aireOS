'use client';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/formatDate';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { promotionRetailerNames, promotionStoreNames } from '@/app/utils/promotionOverview';

/**
 * "FAIRPRICE ON" for one store, "AMK HYPERMART and 52 other stores" for many.
 *
 * @param {string[]} names
 * @returns {string}
 */
function storesLabel(names) {
  if (!names.length) return '—';
  if (names.length === 1) return names[0];
  const others = names.length - 1;
  return `${names[0]} and ${others} other ${others === 1 ? 'store' : 'stores'}`;
}

/**
 * Summary rows that identify one promotion: offer, dates, stores, retailer.
 *
 * @param {object} promotion
 * @returns {Array<{ label: string, value: string }>}
 */
function promotionDetails(promotion) {
  const offer = [promotion.promotion_mechanic, promoTypeLabel(promotion.promo_type)]
    .filter(Boolean)
    .join(' · ');
  return [
    { label: 'Offer', value: offer || '—' },
    {
      label: 'Runs',
      value: `${formatDate(promotion.period_start)} – ${formatDate(promotion.period_end)}`,
    },
    { label: 'Stores', value: storesLabel(promotionStoreNames(promotion)) },
    {
      label: 'Retailer',
      value: promotionRetailerNames(promotion).map(retailerLabel).join(', ') || '—',
    },
  ];
}

/**
 * Confirm before DELETE /api/promotions/{id} so a row click cannot
 * remove a promotion by accident. It names the promotion (offer, dates,
 * stores, retailer) so the user can check it is the right one before
 * confirming. The dialog itself is the shared ui/ConfirmDialog.
 *
 * @param {{
 *   promotion: object | null,
 *   isDeleting: boolean,
 *   onCancel: () => void,
 *   onConfirm: () => void,
 * }} props
 */
export default function ConfirmDeleteDialog({ promotion, isDeleting, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      open={Boolean(promotion)}
      title="Delete this promotion?"
      description="It will be removed permanently. This can’t be undone."
      details={promotion ? promotionDetails(promotion) : []}
      confirmLabel="Delete promotion"
      pendingLabel="Deleting…"
      isPending={isDeleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
