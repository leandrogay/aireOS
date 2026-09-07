'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatPromoDate, promoTypeLabel } from '@/app/utils/promotionForm';
import {
  PROMOTION_STATUSES,
  dedupePromotions,
  filterPromotions,
  promotionStatus,
  promotionStatusLabel,
  sortPromotions,
  uniquePromotionMechanics,
  uniquePromotionPeriods,
  uniquePromotionRetailers,
  uniquePromotionStoreNames,
  uniquePromotionTypes,
} from '@/app/utils/promotionOverview';

const pillClass =
  'inline-flex w-max max-w-[11rem] items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition';
const actionButtonClass =
  'inline-flex min-w-[4rem] items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium shadow-sm transition';

/**
 * Soft status pills that sit with the cream / lavender page, not neon chips.
 *
 * @param {'upcoming' | 'active' | 'past'} status
 * @returns {string}
 */
function statusBadgeClass(status) {
  if (status === 'active') {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'upcoming') {
    return 'border border-violet/40 bg-lavander text-deep-violet-blue';
  }
  return 'border border-lavander bg-cream text-deep-violet-blue/70';
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
 * Confirm before DELETE /api/promotions/{id} so a row click cannot
 * remove a promotion by accident.
 *
 * @param {object} props
 */
function ConfirmDeleteDialog({ promotion, isDeleting, onCancel, onConfirm }) {
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
          <span className="font-medium">{promotion.store_name || 'this store'}</span>
          {promotion.period_label ? ` · ${promotion.period_label}` : ''}
          {promotion.retailer ? ` · ${promotion.retailer}` : ''}.
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

/**
 * Oval column header that opens a filter menu on press.
 *
 * @param {object} props
 */
function HeaderFilter({
  id,
  label,
  value,
  allLabel,
  options,
  openId,
  setOpenId,
  onChange,
}) {
  const open = openId === id;
  const selected = options.find((option) => option.value === value);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, maxHeight: 256 });

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    /**
     * Pin the menu to the header button, flipping up if the table would clip it.
     */
    const placeMenu = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      const maxHeight = 256;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const height = Math.max(120, Math.min(maxHeight, openUp ? spaceAbove : spaceBelow));

      setMenuPos({
        top: openUp ? rect.top - height - 6 : rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 220),
        maxHeight: height,
      });
    };

    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    /**
     * Close when the pointer is outside both the pill and the portaled menu.
     *
     * @param {MouseEvent} event
     */
    const handlePointerDown = (event) => {
      if (
        buttonRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpenId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, setOpenId]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
        className={`${pillClass} ${
          value
            ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
            : 'border-lavander bg-white text-deep-violet-blue hover:bg-cream'
        }`}
      >
        <span className="truncate">{selected ? selected.label : label}</span>
        <span className="text-[8px] leading-none" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              top: menuPos.top,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
            className="fixed z-50 min-w-[12rem] overflow-y-auto rounded-xl border border-lavander bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpenId(null);
              }}
              className={`block w-full px-3 py-1.5 text-left text-[11px] font-normal normal-case tracking-normal hover:bg-cream ${
                !value ? 'font-medium text-deep-violet-blue' : 'text-deep-violet-blue/80'
              }`}
            >
              {allLabel}
            </button>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpenId(null);
                }}
                className={`block w-full px-3 py-1.5 text-left text-[11px] font-normal normal-case tracking-normal hover:bg-cream ${
                  value === option.value
                    ? 'font-medium text-deep-violet-blue'
                    : 'text-deep-violet-blue/80'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * AO4-2 promotion overview: GET /api/promotions rows, with a filter on
 * each column except start/end date. Those two stay sort-only.
 *
 * @param {object} props
 */
export default function PromotionList({
  promotions = [],
  isLoading = false,
  error = '',
  highlightIds = [],
  editingId = null,
  onEdit,
  onDelete,
  onRefresh,
}) {
  const highlighted = new Set(highlightIds);
  const [storeFilter, setStoreFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [promoTypeFilter, setPromoTypeFilter] = useState('');
  const [mechanicFilter, setMechanicFilter] = useState('');
  const [retailerFilter, setRetailerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState('period_start');
  const [sortDirection, setSortDirection] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const uniquePromotions = useMemo(
    () => dedupePromotions(promotions),
    [promotions],
  );
  const storeOptions = useMemo(
    () => uniquePromotionStoreNames(uniquePromotions),
    [uniquePromotions],
  );
  const periodOptions = useMemo(
    () => uniquePromotionPeriods(uniquePromotions),
    [uniquePromotions],
  );
  const typeOptions = useMemo(
    () => uniquePromotionTypes(uniquePromotions),
    [uniquePromotions],
  );
  const mechanicOptions = useMemo(
    () => uniquePromotionMechanics(uniquePromotions),
    [uniquePromotions],
  );
  const retailerOptions = useMemo(
    () => uniquePromotionRetailers(uniquePromotions),
    [uniquePromotions],
  );

  const visible = useMemo(() => {
    const filtered = filterPromotions(
      uniquePromotions,
      {
        storeName: storeFilter,
        period: periodFilter,
        promoType: promoTypeFilter,
        mechanic: mechanicFilter,
        retailer: retailerFilter,
        status: statusFilter,
      },
    );
    return sortPromotions(filtered, sortField, sortDirection);
  }, [
    uniquePromotions,
    storeFilter,
    periodFilter,
    promoTypeFilter,
    mechanicFilter,
    retailerFilter,
    statusFilter,
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

  const clearFilters = () => {
    setStoreFilter('');
    setPeriodFilter('');
    setPromoTypeFilter('');
    setMechanicFilter('');
    setRetailerFilter('');
    setStatusFilter('');
  };

  const hasFilters = Boolean(
    storeFilter ||
      periodFilter ||
      promoTypeFilter ||
      mechanicFilter ||
      retailerFilter ||
      statusFilter,
  );

  /**
   * Close the confirm dialog unless a delete request is already in flight.
   */
  const cancelDelete = () => {
    if (isDeleting) return;
    setPendingDelete(null);
  };

  /**
   * Call DELETE only after Confirm delete. Cancel never hits the API.
   */
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await onDelete?.(pendingDelete);
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (!pendingDelete) return;

    /**
     * @param {KeyboardEvent} event
     */
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') cancelDelete();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pendingDelete, isDeleting]);

  return (
    <section className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl text-deep-violet-blue">Promotion overview</h2>
          <p className="mt-0.5 text-xs text-deep-violet-blue/70">
            {isLoading
              ? 'Loading promotions…'
              : `${visible.length} of ${uniquePromotions.length} shown. Matching input combinations are listed once.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-medium text-deep-violet-blue underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && !uniquePromotions.length && !isLoading && (
        <p className="text-xs text-deep-violet-blue/80">No promotions registered yet.</p>
      )}

      {uniquePromotions.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-lavander">
          <div className="max-h-[28rem] overflow-y-auto">
          <table className="min-w-full text-left text-xs text-deep-violet-blue">
            <thead className="sticky top-0 z-10 bg-cream">
              <tr className="border-b border-lavander">
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="store"
                    label="Store name"
                    value={storeFilter}
                    allLabel="All stores"
                    options={storeOptions.map((name) => ({ value: name, label: name }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setStoreFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="period"
                    label="Period"
                    value={periodFilter}
                    allLabel="All periods"
                    options={periodOptions.map((label) => ({ value: label, label }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setPeriodFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="promoType"
                    label="Promo type"
                    value={promoTypeFilter}
                    allLabel="All types"
                    options={typeOptions.map((type) => ({
                      value: type,
                      label: promoTypeLabel(type),
                    }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setPromoTypeFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="mechanic"
                    label="Mechanic"
                    value={mechanicFilter}
                    allLabel="All mechanics"
                    options={mechanicOptions.map((mechanic) => ({
                      value: mechanic,
                      label: mechanic,
                    }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setMechanicFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort('period_start')}
                    className={`${pillClass} ${
                      sortField === 'period_start'
                        ? 'border-deep-violet-blue bg-white text-deep-violet-blue'
                        : 'border-lavander bg-white text-deep-violet-blue/80 hover:bg-cream'
                    }`}
                  >
                    Start date
                    <span className="text-[8px] leading-none">{sortMark('period_start')}</span>
                  </button>
                </th>
                <th className="px-1.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort('period_end')}
                    className={`${pillClass} ${
                      sortField === 'period_end'
                        ? 'border-deep-violet-blue bg-white text-deep-violet-blue'
                        : 'border-lavander bg-white text-deep-violet-blue/80 hover:bg-cream'
                    }`}
                  >
                    End date
                    <span className="text-[8px] leading-none">{sortMark('period_end')}</span>
                  </button>
                </th>
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="retailer"
                    label="Retailer"
                    value={retailerFilter}
                    allLabel="All retailers"
                    options={retailerOptions.map((name) => ({ value: name, label: name }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setRetailerFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <HeaderFilter
                    id="status"
                    label="Status"
                    value={statusFilter}
                    allLabel="All statuses"
                    options={PROMOTION_STATUSES.map((status) => ({
                      value: status.value,
                      label: status.label,
                    }))}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setStatusFilter}
                  />
                </th>
                <th className="px-1.5 py-2">
                  <span
                    className={`${pillClass} cursor-default border-lavander bg-white text-deep-violet-blue/70`}
                  >
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2.5 py-3 text-deep-violet-blue/80">
                    No promotions match these filters.
                  </td>
                </tr>
              )}
              {visible.map((promotion) => {
                const isNew = highlighted.has(promotion.promotion_id);
                const isEditing = editingId === promotion.promotion_id;
                const isOpen = expandedId === promotion.promotion_id;
                const status = promotionStatus(promotion);
                const skuLabels = Array.isArray(promotion.skus)
                  ? promotion.skus.map((item) => item.sku_range || item.sku).filter(Boolean)
                  : [];
                const rowClass = isEditing
                  ? 'bg-lavander/90'
                  : isNew
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
                        {promotion.store_name || '—'}
                      </td>
                      <td className="px-2.5 py-2">{promotion.period_label || '—'}</td>
                      <td className="px-2.5 py-2">{promoTypeLabel(promotion.promo_type)}</td>
                      <td className="px-2.5 py-2">{promotion.promotion_mechanic || '—'}</td>
                      <td className="px-2.5 py-2">{formatPromoDate(promotion.period_start)}</td>
                      <td className="px-2.5 py-2">{formatPromoDate(promotion.period_end)}</td>
                      <td className="px-2.5 py-2 font-medium">{promotion.retailer || '—'}</td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wide ${statusBadgeClass(status)}`}
                        >
                          {promotionStatusLabel(status)}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onEdit?.(promotion);
                            }}
                            className={`${actionButtonClass} ${
                              isEditing
                                ? 'bg-violet text-deep-violet-blue'
                                : 'bg-deep-violet-blue text-white hover:opacity-90'
                            }`}
                          >
                            {isEditing ? 'Editing' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDelete(promotion);
                            }}
                            className={`${actionButtonClass} border border-deep-violet-blue/25 bg-white text-deep-violet-blue hover:bg-lavander`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-lavander/80">
                        <td colSpan={9} className="bg-cream/50 px-2.5 py-1.5 text-[11px] text-deep-violet-blue">
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                            <DetailTile
                              label="Store"
                              value={promotion.store_name || '—'}
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
        </div>
      )}
      <ConfirmDeleteDialog
        promotion={pendingDelete}
        isDeleting={isDeleting}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
