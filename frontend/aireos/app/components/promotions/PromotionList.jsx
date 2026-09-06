'use client';

import { Fragment, useMemo, useState } from 'react';

import { formatPromoDate, promoTypeLabel } from '@/app/utils/promotionForm';
import {
  PROMOTION_STATUSES,
  filterPromotions,
  promotionEventName,
  promotionOccurrences,
  promotionRecurrenceLabel,
  promotionStatus,
  promotionStatusLabel,
  readStoredRecurrenceMap,
  recurrenceForPromotion,
  sortPromotions,
  uniquePromotionPeriods,
  uniquePromotionRetailers,
  uniquePromotionStores,
} from '@/app/utils/promotionOverview';

const selectClass =
  'rounded-md border border-lavander bg-cream px-2.5 py-1 text-xs text-deep-violet-blue focus:border-violet focus:outline-none';

/**
 * Vibrant status pills so Upcoming / Active / Past read at a glance.
 *
 * @param {'upcoming' | 'active' | 'past'} status
 * @returns {string}
 */
function statusBadgeClass(status) {
  if (status === 'active') {
    return 'bg-emerald-500 text-white';
  }
  if (status === 'upcoming') {
    return 'bg-amber-400 text-amber-950';
  }
  return 'bg-stone-400 text-white';
}

/**
 * Compact labelled box for one expanded-row field.
 *
 * @param {{ label: string, value?: string, children?: import('react').ReactNode }} props
 */
function DetailTile({ label, value, children }) {
  return (
    <div className="rounded-md border border-lavander/80 bg-white px-2 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        {label}
      </p>
      {value ? (
        <p className="mt-0.5 font-medium leading-snug text-deep-violet-blue">{value}</p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * AO4-2 promotion overview: GET /api/promotions rows, with retailer /
 * status / period filters and start/end date sort. Recurrence is shown
 * as frontend-only "Does not repeat" until the backend stores it.
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
  const [retailerFilter, setRetailerFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [sortField, setSortField] = useState('period_start');
  const [sortDirection, setSortDirection] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);
  const recurrenceMap = useMemo(
    () => readStoredRecurrenceMap(),
    [promotions, highlightIds],
  );

  const retailerOptions = useMemo(
    () => uniquePromotionRetailers(promotions),
    [promotions],
  );
  const periodOptions = useMemo(
    () => uniquePromotionPeriods(promotions),
    [promotions],
  );
  const storeOptions = useMemo(
    () => uniquePromotionStores(promotions, retailerFilter),
    [promotions, retailerFilter],
  );

  const visible = useMemo(() => {
    const filtered = filterPromotions(promotions, {
      retailer: retailerFilter,
      store: storeFilter,
      status: statusFilter,
      period: periodFilter,
    });
    return sortPromotions(filtered, sortField, sortDirection);
  }, [
    promotions,
    retailerFilter,
    storeFilter,
    statusFilter,
    periodFilter,
    sortField,
    sortDirection,
  ]);

  /**
   * Toggle start/end sort. Same column again flips direction.
   *
   * @param {'period_start' | 'period_end'} field
   */
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };

  /**
   * Arrow shown on the active date column.
   *
   * @param {'period_start' | 'period_end'} field
   * @returns {string}
   */
  const sortMark = (field) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const hasFilters = Boolean(retailerFilter || storeFilter || statusFilter || periodFilter);

  return (
    <section className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl text-deep-violet-blue">Promotion overview</h2>
          <p className="mt-0.5 text-xs text-deep-violet-blue/70">
            {isLoading
              ? 'Loading promotions…'
              : `${visible.length} of ${promotions.length} shown. Overlapping events stay listed.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-deep-violet-blue/70">
            Retailer
          </span>
          <select
            value={retailerFilter}
            onChange={(event) => {
              setRetailerFilter(event.target.value);
              setStoreFilter('');
            }}
            className={`${selectClass} w-full`}
          >
            <option value="">All retailers</option>
            {retailerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-deep-violet-blue/70">
            Store
          </span>
          <select
            value={storeFilter}
            onChange={(event) => setStoreFilter(event.target.value)}
            className={`${selectClass} w-full`}
          >
            <option value="">All stores</option>
            {storeOptions.map((store) => (
              <option key={store.store_code || store.store_name} value={store.store_code}>
                {store.store_name}
                {store.store_code ? ` (${store.store_code})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-deep-violet-blue/70">
            Status
          </span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={`${selectClass} w-full`}
          >
            <option value="">All statuses</option>
            {PROMOTION_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-deep-violet-blue/70">
            Time period
          </span>
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
            className={`${selectClass} w-full`}
          >
            <option value="">All periods</option>
            {periodOptions.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setRetailerFilter('');
            setStoreFilter('');
            setStatusFilter('');
            setPeriodFilter('');
          }}
          className="mb-2 text-[11px] font-medium text-deep-violet-blue underline-offset-2 hover:underline"
        >
          Clear filters
        </button>
      )}

      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && !promotions.length && !isLoading && (
        <p className="text-xs text-deep-violet-blue/80">No promotions registered yet.</p>
      )}

      {!error && promotions.length > 0 && visible.length === 0 && (
        <p className="text-xs text-deep-violet-blue/80">
          No promotions match these filters.
        </p>
      )}

      {visible.length > 0 && (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-lavander">
          <table className="min-w-full text-left text-xs text-deep-violet-blue">
            <thead className="sticky top-0 bg-cream">
              <tr className="border-b border-lavander font-semibold uppercase tracking-wide text-deep-violet-blue/70">
                <th className="px-2.5 py-2">Event name</th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort('period_start')}
                    className="inline-flex items-center gap-1 hover:text-deep-violet-blue"
                  >
                    Start date <span className="text-[10px]">{sortMark('period_start')}</span>
                  </button>
                </th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort('period_end')}
                    className="inline-flex items-center gap-1 hover:text-deep-violet-blue"
                  >
                    End date <span className="text-[10px]">{sortMark('period_end')}</span>
                  </button>
                </th>
                <th className="px-2.5 py-2">Recurrence</th>
                <th className="px-2.5 py-2">Retailer scope</th>
                <th className="px-2.5 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((promotion) => {
                const isNew = highlighted.has(promotion.promotion_id);
                const isOpen = expandedId === promotion.promotion_id;
                const status = promotionStatus(promotion);
                const skuLabels = Array.isArray(promotion.skus)
                  ? promotion.skus.map((item) => item.sku_range || item.sku).filter(Boolean)
                  : [];
                const recurrence = recurrenceForPromotion(promotion, recurrenceMap);
                const occurrences = promotionOccurrences(promotion, recurrence);
                const rowClass = isNew
                  ? 'bg-lavander/70'
                  : isOpen
                    ? 'bg-cream/80'
                    : 'bg-white hover:bg-cream/50';

                return (
                  <Fragment key={promotion.promotion_id}>
                    <tr
                      className={`cursor-pointer border-b border-lavander/80 ${rowClass}`}
                      onClick={() =>
                        setExpandedId(isOpen ? null : promotion.promotion_id)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setExpandedId(isOpen ? null : promotion.promotion_id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td className="px-2.5 py-2 font-medium">
                        <span className="mr-1.5 inline-block w-2 text-[10px] text-deep-violet-blue/50">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        {promotionEventName(promotion)}
                        <span className="mt-0.5 block pl-3.5 text-[10px] font-normal text-deep-violet-blue/55">
                          {promotion.store_name || '—'}
                          {promotion.store_code != null ? ` (${promotion.store_code})` : ''}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">{formatPromoDate(promotion.period_start)}</td>
                      <td className="px-2.5 py-2">{formatPromoDate(promotion.period_end)}</td>
                      <td className="px-2.5 py-2 text-deep-violet-blue/80">
                        {promotionRecurrenceLabel(recurrence)}
                      </td>
                      <td className="px-2.5 py-2 font-medium">{promotion.retailer || '—'}</td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${statusBadgeClass(status)}`}
                        >
                          {promotionStatusLabel(status)}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-lavander/80">
                        <td colSpan={6} className="bg-cream/50 px-2.5 py-1.5 text-[11px] text-deep-violet-blue">
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">
                            <DetailTile
                              label="Store"
                              value={`${promotion.store_name || '—'}${
                                promotion.store_code != null ? ` (${promotion.store_code})` : ''
                              }`}
                            />
                            <DetailTile
                              label="Format"
                              value={promotion.store_format || '—'}
                            />
                            <DetailTile
                              label="Type"
                              value={promoTypeLabel(promotion.promo_type)}
                            />
                            <DetailTile
                              label="Mechanic"
                              value={promotion.promotion_mechanic || '—'}
                            />
                            <DetailTile
                              label="Voucher"
                              value={promotion.voucher || '—'}
                            />
                            <DetailTile
                              label="SKU range"
                              value={skuLabels.length ? skuLabels.join(', ') : '—'}
                            />
                            <DetailTile
                              label="Recurrence"
                              value={promotionRecurrenceLabel(recurrence)}
                            >
                              {recurrence !== 'none' && occurrences.length > 1 && (
                                <p className="mt-0.5 text-[10px] leading-snug text-deep-violet-blue/70">
                                  {occurrences
                                    .slice(1, 3)
                                    .map((occurrence) => `${occurrence.start} – ${occurrence.end}`)
                                    .join(' · ')}
                                  {occurrences.length > 3
                                    ? ` · +${occurrences.length - 3} more`
                                    : ''}
                                </p>
                              )}
                            </DetailTile>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
