'use client';

import { formatPromoDate, promoTypeLabel } from '@/app/utils/promotionForm';

/**
 * Compact overview of promotions already stored in Cloud SQL.
 *
 * Dates come from period_start / period_end. period_label is shown as the
 * tag the next user story will reuse (MMM-YYYY or, later, W__-YYYY).
 *
 * @param {object} props
 */
export default function PromotionList({
  promotions = [],
  isLoading = false,
  error = '',
  highlightIds = [],
  onRefresh,
}) {
  const highlighted = new Set(highlightIds);

  return (
    <section className="rounded-lg border border-lavander bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-deep-violet-blue">Promotion overview</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && !promotions.length && !isLoading && (
        <p className="text-xs text-deep-violet-blue/80">No promotions registered yet.</p>
      )}

      {promotions.length > 0 && (
        <div className="max-h-48 overflow-auto">
          <table className="min-w-full text-left text-xs text-deep-violet-blue">
            <thead>
              <tr className="border-b border-lavander font-semibold uppercase tracking-wide text-deep-violet-blue/70">
                <th className="px-2 py-1">Tag</th>
                <th className="px-2 py-1">Retailer</th>
                <th className="px-2 py-1">Store</th>
                <th className="px-2 py-1">Dates</th>
                <th className="px-2 py-1">Mechanic</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promotion) => {
                const isNew = highlighted.has(promotion.promotion_id);
                return (
                  <tr
                    key={promotion.promotion_id}
                    className={`border-b border-lavander/80 ${isNew ? 'bg-lavander/60' : 'bg-white'}`}
                  >
                    <td className="px-2 py-1">
                      {promotion.period_label ? (
                        <span className="rounded-full bg-lavander px-2 py-0.5 font-medium text-deep-violet-blue">
                          {promotion.period_label}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1 font-medium">{promotion.retailer || '—'}</td>
                    <td className="px-2 py-1">
                      {promotion.store_name || '—'}
                      {promotion.store_code != null ? (
                        <span className="ml-1 font-mono text-[10px] text-deep-violet-blue/70">
                          ({promotion.store_code})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1">
                      {formatPromoDate(promotion.period_start)} – {formatPromoDate(promotion.period_end)}
                    </td>
                    <td className="px-2 py-1">
                      {promotion.promotion_mechanic || promoTypeLabel(promotion.promo_type)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
