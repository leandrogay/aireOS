'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  promotionRetailerNames,
  promotionStoreNames,
  summariseNames,
} from '@/app/utils/promotionOverview';

/**
 * Confirm before DELETE /api/promotions/{id} so a row click cannot
 * remove a promotion by accident.
 *
 * @param {{
 *   promotion: object | null,
 *   isDeleting: boolean,
 *   onCancel: () => void,
 *   onConfirm: () => void,
 * }} props
 */
export default function ConfirmDeleteDialog({ promotion, isDeleting, onCancel, onConfirm }) {
  useEffect(() => {
    if (!promotion) return;

    /**
     * @param {KeyboardEvent} event
     */
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [promotion, onCancel]);

  if (!promotion || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-deep-violet-blue/40 px-4"
      onClick={() => {
        if (!isDeleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-promotion-title"
        className="w-full max-w-md rounded-lg border border-lavander bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="delete-promotion-title"
          className="font-serif text-lg text-deep-violet-blue"
        >
          Delete this promotion?
        </h3>
        <p className="mt-2 text-sm text-deep-violet-blue/80">
          This cannot be undone. The overview will drop{' '}
          <span className="font-medium">
            {summariseNames(promotionStoreNames(promotion), 'this promotion')}
          </span>
          {promotion.period_label ? ` · ${promotion.period_label}` : ''}
          {promotionRetailerNames(promotion).length
            ? ` · ${promotionRetailerNames(promotion).map(retailerLabel).join(', ')}`
            : ''}
          .
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1.5 text-sm font-medium text-deep-violet-blue hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-md border border-red-700 bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting…' : 'Confirm delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
