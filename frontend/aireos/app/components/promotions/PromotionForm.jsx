'use client';

import { useState } from 'react';
import DateRangePicker from '@/components/ui/DateRangePicker';
import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import { cn } from '@/lib/utils';
import {
  EMPTY_PROMOTION_FORM,
  PACK_TYPES,
  PROMO_TYPES,
  areAllRetailersSelected,
  areAllSkuRangesSelected,
  areAllStoresSelected,
  promoTypeLabel,
  retailerDropdownOptions,
  retailerLabel,
  storeCatalogOptions,
  storesForRetailerIds,
} from '@/app/utils/promotionForm';

const inputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none';
const invalidInputClass = 'border-red-400 focus:border-red-500';
const labelClass = 'mb-1 block text-xs font-medium text-deep-violet-blue';
const errorClass = 'mt-1 text-xs text-red-700';
const hintClass = 'mt-1 text-[11px] text-deep-violet-blue/60';
const checkRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';
// Segmented radio chip: the native radio is visually hidden and the label
// itself shows the checked / focused state.
const chipClass =
  'flex flex-1 cursor-pointer items-center justify-center rounded-md border border-lavander bg-cream px-3 py-1.5 text-sm text-deep-violet-blue transition has-[:checked]:border-deep-violet-blue has-[:checked]:bg-deep-violet-blue has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet';

/**
 * Red asterisk shown after a required field's label. The header explains
 * the mark once, so screen readers skip it.
 */
function RequiredMark() {
  return (
    <span className="text-red-700" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

/**
 * Muted "(optional)" suffix so the optional fields read as such without
 * relying on a placeholder that disappears once the user types.
 */
function OptionalMark() {
  return (
    <span className="font-normal text-deep-violet-blue/50"> (optional)</span>
  );
}

/**
 * Inline validation message under a field after a failed submit.
 *
 * @param {{ message?: string }} props
 */
function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className={errorClass} role="alert">
      {message}
    </p>
  );
}

/**
 * One numbered group of related fields. The heading and hint sit in a
 * narrow left column on wide screens so the fields keep their width;
 * on small screens they stack.
 *
 * @param {{
 *   step: number,
 *   title: string,
 *   hint: string,
 *   children: React.ReactNode,
 * }} props
 */
function FormSection({ step, title, hint, children }) {
  return (
    <section className="grid gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-deep-violet-blue font-mono text-[11px] font-medium text-white"
          aria-hidden="true"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-deep-violet-blue">{title}</h3>
          <p className="mt-0.5 text-xs leading-snug text-deep-violet-blue/65">{hint}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Free-text mechanic, e.g. "25% off". The API stores one varchar.
 *
 * @param {{ value: string, onChange: (value: string) => void, error?: string }} props
 */
function PromotionMechanicField({ value, onChange, error }) {
  return (
    <label>
      <span className={labelClass}>
        Mechanic
        <RequiredMark />
      </span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, error && invalidInputClass)}
        aria-invalid={Boolean(error)}
        placeholder="e.g. 25% off"
        maxLength={255}
        required
      />
      <FieldError message={error} />
    </label>
  );
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
      <span className={labelClass}>
        Voucher
        <OptionalMark />
      </span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, error && invalidInputClass)}
        aria-invalid={Boolean(error)}
        placeholder="e.g. $5 off $50"
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
      <span className={labelClass}>
        Period label
        <OptionalMark />
      </span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, error && invalidInputClass)}
        aria-invalid={Boolean(error)}
        placeholder="e.g. Mid-year sale"
        maxLength={100}
      />
      <FieldError message={error} />
    </label>
  );
}

/**
 * AO4-1 create / edit form, laid out as four numbered sections in the
 * order a planner fills them in: where, when, what, which products.
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
        .map((retailer) => retailerLabel(retailer.retailer_name))
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
  // Inline messages sit next to each field; the footer repeats the count so
  // the user standing at the submit button knows to scroll up.
  const errorCount = Object.values(errors).filter(Boolean).length;

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
      className={cn(
        'rounded-lg border border-lavander bg-white shadow-sm',
        isFlashing && 'animate-edit-flash',
      )}
      onAnimationEnd={(event) => {
        // Child widgets have their own animations; only react to ours.
        if (event.animationName === 'edit-flash') setSeenFlashKey(flashKey);
      }}
    >
      {/* ==== Header ==== */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-lavander px-4 py-3">
        <div>
          <h2 className="font-serif text-xl text-deep-violet-blue">
            {isEdit ? 'Edit promotion' : 'Create promotion'}
          </h2>
          <p className="mt-0.5 text-xs text-deep-violet-blue/65">
            Fields marked <span className="text-red-700">*</span> are required.
          </p>
        </div>
        {isEdit && (
          <span className="rounded-full border border-violet bg-lavander px-2.5 py-0.5 text-[11px] font-medium text-deep-violet-blue">
            Editing existing promotion
          </span>
        )}
      </div>

      <div className="divide-y divide-lavander">
        {/* ==== 1. Where ==== */}
        <FormSection
          step={1}
          title="Retailers & stores"
          hint="Pick retailers first; the store list is limited to the ones you tick."
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 [&>*]:min-w-0">
            <fieldset>
              <legend className={labelClass}>
                Retailers
                <RequiredMark />
              </legend>
              <CheckboxDropdown
                summary={retailerSummary}
                placeholder={
                  isLoadingRetailers ? 'Loading retailers…' : 'Select retailers'
                }
                disabled={isLoadingRetailers || retailerOptions.length === 0}
                invalid={Boolean(errors.retailerScope)}
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
                    <span className="min-w-0 truncate">
                      {retailerLabel(retailer.retailer_name)}
                    </span>
                  </label>
                ))}
              </CheckboxDropdown>
              {retailersError && <p className={errorClass}>{retailersError}</p>}
              {!isLoadingRetailers && !retailersError && retailerOptions.length === 0 && (
                <p className={hintClass}>No retailers yet.</p>
              )}
              <FieldError message={errors.retailerScope} />
            </fieldset>

            <fieldset>
              <legend className={labelClass}>
                Stores
                <RequiredMark />
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
                invalid={Boolean(errors.storeName)}
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
              {!isLoadingStores && !storesError && (
                // Always rendered so the line does not vanish (and shift the
                // form) the moment a retailer is ticked.
                <p className={hintClass}>
                  {storesNeedRetailer
                    ? 'Stores appear after you pick retailers.'
                    : storeOptions.length === 0
                      ? 'No stores for the selected retailers.'
                      : `${storeOptions.length} ${storeOptions.length === 1 ? 'store' : 'stores'} available.`}
                </p>
              )}
              <FieldError message={errors.storeName} />
            </fieldset>
          </div>
        </FormSection>

        {/* ==== 2. When ==== */}
        <FormSection
          step={2}
          title="Period"
          hint="The dates the promotion runs. The label is a name for your own reference."
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
            <DateRangePicker
              className="contents"
              start={form.periodStart}
              end={form.periodEnd}
              onStartChange={(periodStart) => patchForm({ periodStart })}
              onEndChange={(periodEnd) => patchForm({ periodEnd })}
              required
              startError={errors.periodStart}
              endError={errors.periodEnd}
              labelClassName={labelClass}
              inputClassName="py-1.5"
            />

            <PeriodLabelField
              value={form.periodLabel}
              onChange={(periodLabel) => patchForm({ periodLabel })}
              error={errors.periodLabel}
            />
          </div>
        </FormSection>

        {/* ==== 3. What ==== */}
        <FormSection
          step={3}
          title="Offer"
          hint="The kind of promotion and what the shopper gets."
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <fieldset>
              <legend className={labelClass}>
                Promo type
                <RequiredMark />
              </legend>
              <CheckboxDropdown
                summary={promoTypeLabel(form.promoType)}
                placeholder="Select promo type"
                invalid={Boolean(errors.promoType)}
              >
                {(_query, close) =>
                  PROMO_TYPES.map((option) => (
                    <label key={option.value} className={checkRowClass}>
                      <input
                        type="radio"
                        name="promoType"
                        value={option.value}
                        checked={form.promoType === option.value}
                        onChange={() => {
                          patchForm({ promoType: option.value });
                          close();
                        }}
                        className="size-3.5 accent-deep-violet-blue"
                      />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </label>
                  ))
                }
              </CheckboxDropdown>
              <FieldError message={errors.promoType} />
            </fieldset>

            <fieldset>
              <legend className={labelClass}>
                Pack type
                <RequiredMark />
              </legend>
              <div
                className={cn('flex gap-1.5', errors.packType && '[&>label]:border-red-400')}
              >
                {PACK_TYPES.map((option) => (
                  <label key={option.value} className={chipClass}>
                    <input
                      type="radio"
                      name="packType"
                      value={option.value}
                      checked={form.packType === option.value}
                      onChange={() => patchForm({ packType: option.value })}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <FieldError message={errors.packType} />
            </fieldset>

            <PromotionMechanicField
              value={form.promotionMechanic}
              onChange={(promotionMechanic) => patchForm({ promotionMechanic })}
              error={errors.promotionMechanic}
            />

            <VoucherField
              value={form.voucher}
              onChange={(voucher) => patchForm({ voucher })}
              error={errors.voucher}
            />
          </div>
        </FormSection>

        {/* ==== 4. Which products ==== */}
        <FormSection
          step={4}
          title="Products"
          hint="Every SKU in the ticked ranges is linked to this promotion."
        >
          <fieldset className="sm:max-w-sm">
            <legend className={labelClass}>
              SKU range
              <RequiredMark />
            </legend>
            <CheckboxDropdown
              summary={skuSummary}
              placeholder={
                isLoadingSkuRanges ? 'Loading SKU ranges…' : 'Select SKU ranges'
              }
              disabled={isLoadingSkuRanges || skuRangeOptions.length === 0}
              invalid={Boolean(errors.skuRanges)}
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
            {skuRangesError && <p className={errorClass}>{skuRangesError}</p>}
            {!isLoadingSkuRanges && !skuRangesError && skuRangeOptions.length === 0 && (
              <p className={hintClass}>No SKU ranges yet.</p>
            )}
            <FieldError message={errors.skuRanges} />
          </fieldset>
        </FormSection>
      </div>

      {/* ==== Actions ==== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <p className="text-xs text-red-700" role="status">
          {errorCount > 0 &&
            `Fix ${errorCount} highlighted ${errorCount === 1 ? 'field' : 'fields'} above.`}
        </p>
        <div className="flex items-center gap-2">
          {isEdit && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="rounded-md border border-deep-violet-blue/30 bg-white px-4 py-1.5 text-sm font-medium text-deep-violet-blue transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Create promotion'}
          </button>
        </div>
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
