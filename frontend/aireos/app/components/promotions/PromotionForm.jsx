'use client';

import { useState } from 'react';
import DateRangePicker from '@/components/ui/DateRangePicker';
import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import {
  EMPTY_PROMOTION_FORM,
  PROMO_MECHANICS,
  PROMO_TYPES,
  areAllRetailersSelected,
  areAllSkuRangesSelected,
  areAllStoresSelected,
  retailerDropdownOptions,
  storeCatalogOptions,
  storesForRetailerIds,
} from '@/app/utils/promotionForm';

const inputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1 text-sm text-deep-violet-blue focus:border-violet focus:outline-none';
const labelClass = 'mb-0.5 block text-xs font-medium text-deep-violet-blue';
const gridClass =
  'grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4 [&>*]:min-w-0 [&>*]:max-w-full';
const errorClass = 'mt-0.5 text-xs text-red-700';
const checkRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';

/**
 * Inline validation message under a field after a failed submit.
 *
 * @param {{ message?: string }} props
 */
function FieldError({ message }) {
  if (!message) return null;
  return <p className={errorClass}>{message}</p>;
}

/**
 * Free-text voucher. The API stores one optional varchar, so this is not
 * limited to "$X off $Y" amounts.
 *
 * @param {{ value: string, onChange: (value: string) => void, error?: string }} props
 */
function VoucherField({ value, onChange, error }) {
  return (
    <label>
      <span className={labelClass}>Voucher</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        placeholder="Optional"
        maxLength={255}
      />
      <FieldError message={error} />
    </label>
  );
}

/**
 * Free-text period_label. Optional, same idea as voucher.
 *
 * @param {{ value: string, onChange: (value: string) => void, error?: string }} props
 */
function PeriodLabelField({ value, onChange, error }) {
  return (
    <label>
      <span className={labelClass}>Period label</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        placeholder="Optional"
        maxLength={100}
      />
      <FieldError message={error} />
    </label>
  );
}

/**
 * Compact AO4-1 create / edit form.
 *
 * Stores are scoped to the ticked retailers. Start and end dates map
 * to period_start / period_end. period_label is optional free text.
 * SKU ranges come from GET /api/catalog/sku-ranges. Create posts one
 * promotion whose `stores` array holds every valid retailer × store
 * pair; edit sends the same shape and replaces the store set.
 *
 * `flashKey` is a counter the parent increments when Edit is pressed;
 * each change plays a brief highlight so the user's eye lands on the
 * form after the page scrolls to it.
 *
 * @param {object} props
 */
export default function PromotionForm({
  form,
  onChange,
  retailers = [],
  stores = [],
  skuRangeOptions = [],
  retailersError = '',
  storesError = '',
  skuRangesError = '',
  isLoadingRetailers = false,
  isLoadingStores = false,
  isLoadingSkuRanges = false,
  isSubmitting = false,
  errors = {},
  onSubmit,
  mode = 'create',
  flashKey = 0,
  onCancel,
}) {
  const isEdit = mode === 'edit';
  // The flash plays while the parent's flashKey is one we haven't finished
  // animating yet; onAnimationEnd marks it seen so the next bump restarts it.
  const [seenFlashKey, setSeenFlashKey] = useState(flashKey);
  const isFlashing = flashKey !== seenFlashKey;
  const retailerOptions = retailerDropdownOptions(retailers);
  const storeOptions = storeCatalogOptions(
    storesForRetailerIds(stores, form.selectedRetailerIds),
  );
  const storesNeedRetailer = !(form.selectedRetailerIds || []).length;
  const allRetailersSelected = areAllRetailersSelected(
    form.selectedRetailerIds,
    retailerOptions,
  );
  const allStoresSelected = areAllStoresSelected(form.selectedStoreCodes, storeOptions);
  const allSkuRangesSelected = areAllSkuRangesSelected(form.skuRanges, skuRangeOptions);
  const retailerSummary = allRetailersSelected
    ? 'All retailers'
    : retailerOptions
        .filter((retailer) =>
          (form.selectedRetailerIds || []).map(String).includes(String(retailer.retailer_id)),
        )
        .map((retailer) => retailer.retailer_name)
        .join(', ');
  const storeSummary = allStoresSelected
    ? 'All stores'
    : storeOptions
        .filter((store) =>
          (form.selectedStoreCodes || []).map(String).includes(String(store.store_code)),
        )
        .map((store) => store.store_name)
        .join(', ');
  const skuSummary = allSkuRangesSelected ? 'All SKU ranges' : form.skuRanges.join(', ');

  /**
   * Patch one or more form fields.
   *
   * @param {object} patch
   */
  const patchForm = (patch) => {
    onChange({
      ...form,
      ...patch,
    });
  };

  /**
   * Tick or untick one retailer. Unticking any box also clears the
   * "All retailers" shortcut because the set is no longer complete.
   *
   * @param {number} retailerId
   */
  const toggleRetailer = (retailerId) => {
    const id = String(retailerId);
    const selected = (form.selectedRetailerIds || []).map(String);
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];

    patchForm({
      selectedRetailerIds: next,
      selectedStoreCodes: storeCodesAllowedForRetailers(next),
    });
  };

  /**
   * Tick every retailer checkbox, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllRetailers = (checked) => {
    const next = checked
      ? retailerOptions.map((retailer) => String(retailer.retailer_id))
      : [];
    patchForm({
      selectedRetailerIds: next,
      selectedStoreCodes: storeCodesAllowedForRetailers(next),
    });
  };

  /**
   * Keep only store codes that belong to the given retailer ids.
   *
   * @param {string[]} retailerIds
   * @returns {string[]}
   */
  const storeCodesAllowedForRetailers = (retailerIds) => {
    const allowed = new Set(
      storeCatalogOptions(storesForRetailerIds(stores, retailerIds)).map((store) =>
        String(store.store_code),
      ),
    );
    return (form.selectedStoreCodes || [])
      .map(String)
      .filter((code) => allowed.has(code));
  };

  /**
   * Tick or untick one store among the current retailer's catalog.
   *
   * @param {string} storeCode
   */
  const toggleStore = (storeCode) => {
    const code = String(storeCode);
    const selected = (form.selectedStoreCodes || []).map(String);
    const next = selected.includes(code)
      ? selected.filter((item) => item !== code)
      : [...selected, code];
    patchForm({ selectedStoreCodes: next });
  };

  /**
   * Tick every store checkbox, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllStores = (checked) => {
    patchForm({
      selectedStoreCodes: checked
        ? storeOptions.map((store) => String(store.store_code))
        : [],
    });
  };

  /**
   * Tick every SKU range, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllSkuRanges = (checked) => {
    patchForm({ skuRanges: checked ? [...skuRangeOptions] : [] });
  };

  /**
   * Toggle a SKU range checkbox. More than one range can be selected.
   *
   * @param {string} range
   */
  const toggleSkuRange = (range) => {
    const selected = form.skuRanges.includes(range)
      ? form.skuRanges.filter((item) => item !== range)
      : [...form.skuRanges, range];
    patchForm({ skuRanges: selected });
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className={`rounded-lg border border-lavander bg-white p-3 shadow-sm ${
        isFlashing ? 'animate-edit-flash' : ''
      }`}
      onAnimationEnd={(event) => {
        // Child widgets have their own animations; only react to ours.
        if (event.animationName === 'edit-flash') setSeenFlashKey(flashKey);
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl text-deep-violet-blue">
          {isEdit ? 'Edit promotion' : 'Create promotion'}
        </h2>
        <p className="text-xs text-deep-violet-blue/70">
          Required fields <span className="text-red-700">*</span>
        </p>
      </div>

      <div className={gridClass}>
        <fieldset>
          <legend className={labelClass}>
            Retailers <span className="text-red-700">*</span>
          </legend>
          <CheckboxDropdown
            summary={retailerSummary}
            placeholder={
              isLoadingRetailers ? 'Loading retailers…' : 'Select retailers'
            }
            disabled={isLoadingRetailers || retailerOptions.length === 0}
          >
            <label className={`${checkRowClass} font-medium`}>
              <input
                type="checkbox"
                checked={allRetailersSelected}
                onChange={(event) => toggleAllRetailers(event.target.checked)}
                className="size-3.5 accent-deep-violet-blue"
              />
              All retailers
            </label>
            {retailerOptions.map((retailer) => (
              <label key={retailer.retailer_id} className={checkRowClass}>
                <input
                  type="checkbox"
                  checked={(form.selectedRetailerIds || [])
                    .map(String)
                    .includes(String(retailer.retailer_id))}
                  onChange={() => toggleRetailer(retailer.retailer_id)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                <span className="min-w-0 truncate">{retailer.retailer_name}</span>
              </label>
            ))}
          </CheckboxDropdown>
          {retailersError && <p className={errorClass}>{retailersError}</p>}
          {!isLoadingRetailers && !retailersError && retailerOptions.length === 0 && (
            <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
              No retailers yet.
            </p>
          )}
          <FieldError message={errors.retailerScope} />
        </fieldset>

        <fieldset>
          <legend className={labelClass}>
            Stores <span className="text-red-700">*</span>
          </legend>
          <CheckboxDropdown
            summary={storeSummary}
            placeholder={
              isLoadingStores
                ? 'Loading stores…'
                : storesNeedRetailer
                  ? 'Select retailers first'
                  : 'Select stores'
            }
            disabled={
              isLoadingStores || storesNeedRetailer || storeOptions.length === 0
            }
            searchable
            searchPlaceholder="Search stores…"
          >
            {(query) => {
              const needle = query.trim().toLowerCase();
              const visibleStores = needle
                ? storeOptions.filter((store) => {
                    const name = String(store.store_name || '').toLowerCase();
                    const code = String(store.store_code || '').toLowerCase();
                    return name.includes(needle) || code.includes(needle);
                  })
                : storeOptions;

              return (
                <>
                  <label className={`${checkRowClass} font-medium`}>
                    <input
                      type="checkbox"
                      checked={allStoresSelected}
                      onChange={(event) => toggleAllStores(event.target.checked)}
                      className="size-3.5 accent-deep-violet-blue"
                    />
                    All stores
                  </label>
                  {visibleStores.map((store) => (
                    <label key={store.store_code} className={checkRowClass}>
                      <input
                        type="checkbox"
                        checked={(form.selectedStoreCodes || [])
                          .map(String)
                          .includes(String(store.store_code))}
                        onChange={() => toggleStore(store.store_code)}
                        className="size-3.5 accent-deep-violet-blue"
                      />
                      <span className="min-w-0 truncate">{store.store_name}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-deep-violet-blue/60">
                        {store.store_code}
                      </span>
                    </label>
                  ))}
                  {needle && visibleStores.length === 0 && (
                    <p className="px-2 py-1 text-xs text-deep-violet-blue/60">
                      No stores match.
                    </p>
                  )}
                </>
              );
            }}
          </CheckboxDropdown>
          {storesError && <p className={errorClass}>{storesError}</p>}
          {!isLoadingStores && !storesError && storesNeedRetailer && (
            <p className="mt-0.5 text-[10px] text-deep-violet-blue/60">
              Stores appear after you pick retailers.
            </p>
          )}
          {!isLoadingStores && !storesError && !storesNeedRetailer && storeOptions.length === 0 && (
            <p className="mt-0.5 text-[10px] text-deep-violet-blue/60">
              No stores for the selected retailers.
            </p>
          )}
          <FieldError message={errors.storeName} />
        </fieldset>

        <DateRangePicker
          className="contents"
          start={form.periodStart}
          end={form.periodEnd}
          onStartChange={(periodStart) => patchForm({ periodStart })}
          onEndChange={(periodEnd) => patchForm({ periodEnd })}
          required
          startError={errors.periodStart}
          endError={errors.periodEnd}
        />

        <PeriodLabelField
          value={form.periodLabel}
          onChange={(periodLabel) => patchForm({ periodLabel })}
          error={errors.periodLabel}
        />

        <label>
          <span className={labelClass}>
            Promo type <span className="text-red-700">*</span>
          </span>
          <select
            value={form.promoType}
            onChange={(event) => patchForm({ promoType: event.target.value })}
            className={inputClass}
          >
            {PROMO_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.promoType} />
        </label>

        <label>
          <span className={labelClass}>
            Mechanic <span className="text-red-700">*</span>
          </span>
          <select
            value={form.promotionMechanic}
            onChange={(event) => patchForm({ promotionMechanic: event.target.value })}
            className={inputClass}
          >
            {PROMO_MECHANICS.map((mechanic) => (
              <option key={mechanic} value={mechanic}>
                {mechanic}
              </option>
            ))}
          </select>
          <FieldError message={errors.promotionMechanic} />
        </label>

        <VoucherField
          value={form.voucher}
          onChange={(voucher) => patchForm({ voucher })}
          error={errors.voucher}
        />

        <fieldset>
          <legend className={labelClass}>
            SKU range <span className="text-red-700">*</span>
          </legend>
          <CheckboxDropdown
            summary={skuSummary}
            placeholder={
              isLoadingSkuRanges ? 'Loading SKU ranges…' : 'Select SKU ranges'
            }
            disabled={isLoadingSkuRanges || skuRangeOptions.length === 0}
          >
            <label className={`${checkRowClass} font-medium`}>
              <input
                type="checkbox"
                checked={allSkuRangesSelected}
                onChange={(event) => toggleAllSkuRanges(event.target.checked)}
                className="size-3.5 accent-deep-violet-blue"
              />
              All SKU ranges
            </label>
            {skuRangeOptions.map((range) => (
              <label key={range} className={checkRowClass}>
                <input
                  type="checkbox"
                  checked={form.skuRanges.includes(range)}
                  onChange={() => toggleSkuRange(range)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                <span className="min-w-0 truncate">{range}</span>
              </label>
            ))}
          </CheckboxDropdown>
          <FieldError message={errors.skuRanges} />
          {skuRangesError && <p className={errorClass}>{skuRangesError}</p>}
          {!isLoadingSkuRanges && !skuRangesError && skuRangeOptions.length === 0 && (
            <p className="mt-0.5 text-[10px] text-deep-violet-blue/60">No SKU ranges yet.</p>
          )}
        </fieldset>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting
            ? 'Saving…'
            : isEdit
              ? 'Save changes'
              : 'Create promotion'}
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-deep-violet-blue/30 bg-white px-4 py-1.5 text-sm font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Blank create-form state, including a fresh skuRanges array.
 *
 * @returns {typeof EMPTY_PROMOTION_FORM}
 */
export function blankPromotionForm() {
  return {
    ...EMPTY_PROMOTION_FORM,
    selectedRetailerIds: [],
    selectedStoreCodes: [],
    skuRanges: [],
  };
}
