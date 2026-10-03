'use client';

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';

import { formatDate } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import {
  promotionRetailerNames,
  promotionStatus,
  promotionStatusLabel,
  promotionStoreNames,
  summariseNames,
} from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';
import PromotionDetails from '@/components/promotions/PromotionDetails';
import PromotionRowActions from '@/components/promotions/PromotionRowActions';

// Soft pills that sit with the cream / lavender page. The dot repeats the
// word's meaning in a shape, so the status never rests on colour alone.
const STATUS_STYLES = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  upcoming: 'border-violet/40 bg-lavander text-deep-violet-blue',
  past: 'border-lavander bg-cream text-deep-violet-blue/70',
};

function StatusPill({ status }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {promotionStatusLabel(status)}
    </span>
  );
}

/**
 * One promotion: its table row plus, when expanded, a details row under it.
 * Clicking anywhere on the row toggles the details; the chevron button is the
 * keyboard route to the same toggle.
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

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={cn(
          'h-12 cursor-pointer border-b border-lavander/80 transition-colors',
          isEditing
            ? 'bg-lavander/90'
            : isNew
              ? 'bg-lavander/70'
              : isOpen
                ? 'bg-cream/80'
                : 'bg-white hover:bg-cream/50',
        )}
      >
        <td className="px-4 py-2.5 font-medium" title={retailerNames.join(', ') || undefined}>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Hide details' : 'Show details'}
            onClick={(event) => {
              // The row's own onClick toggles too; one toggle per click.
              event.stopPropagation();
              onToggle();
            }}
            className="inline-flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-deep-violet-blue/50 transition-transform',
                isOpen && 'rotate-90',
              )}
            />
            {summariseNames(retailerNames)}
          </button>
        </td>
        <td className="px-4 py-2.5 font-medium" title={storeNames.join(', ') || undefined}>
          <span className="block max-w-[14rem] truncate">{summariseNames(storeNames)}</span>
        </td>
        <td className="px-4 py-2.5 tabular-nums">{formatDate(promotion.period_start)}</td>
        <td className="px-4 py-2.5 tabular-nums">{formatDate(promotion.period_end)}</td>
        {/* Multi-week labels ("W20-2025, W21-2025, W22-2025") wrap instead of
            stretching the column for every short "Dec-2026" row. Each word is
            nowrap so lines break only at spaces, never after the hyphen in
            "W21-2025". */}
        <td className="px-4 py-2.5" title={promotion.period_label || undefined}>
          <span className="block max-w-[7rem] whitespace-normal leading-snug">
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
        <td className="px-4 py-2.5">{promoTypeLabel(promotion.promo_type)}</td>
        <td className="px-4 py-2.5" title={promotion.promotion_mechanic || undefined}>
          <span className="block max-w-[10rem] truncate">{promotion.promotion_mechanic || '-'}</span>
        </td>
        <td className="px-4 py-2.5">
          <StatusPill status={promotionStatus(promotion)} />
        </td>
        {/* React events bubble through portals, so without this a click on a
            menu item would also reach the row's toggle. */}
        <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
          <PromotionRowActions
            promotion={promotion}
            isEditing={isEditing}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-lavander/80">
          <td colSpan={9} className="whitespace-normal bg-cream/50 px-4 py-3">
            <PromotionDetails promotion={promotion} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
