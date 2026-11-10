'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import DateRangePicker from '@/components/ui/DateRangePicker';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import SelectDropdown from '@/components/ui/SelectDropdown';
import MonthPicker from '@/components/promotions/MonthPicker';
import { formatDate } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import {
  EMPTY_PROMOTION_FORM,
  MONTHLY_PROMO_TYPE,
  PACK_TYPES,
  PROMO_TYPES,
  estimatedMechanicDiscount,
  promoTypePatch,
  retailerDropdownOptions,
  storeCatalogOptions,
  storesForRetailerIds,
} from '@/app/utils/promotionForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

const inputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none';
const invalidInputClass = 'border-red-400 focus:border-red-500';
const labelClass = 'mb-1 block text-xs font-medium text-deep-violet-blue';
const errorClass = 'mt-1 text-xs text-red-700';
const hintClass = 'mt-1 text-[11px] text-deep-violet-blue/60';
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
 * Structured inputs are saved as a canonical mechanic for existing rows/API.
 *
 * @param {{ form: object, onChange: (patch: object) => void, error?: string }} props
 */
function PromotionMechanicField({ form, onChange, error }) {
  const estimatedDiscount = estimatedMechanicDiscount(form);
  const needsBuy = form.mechanicType === 'buy_get_free' || form.mechanicType === 'buy_get_percent';
  const needsPercent = form.mechanicType === 'buy_get_percent' || form.mechanicType === 'percent_off';
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className={labelClass}>
        Mechanic
        <RequiredMark />
      </legend>
      <SelectDropdown
        ariaLabel="Promotion mechanic"
        value={form.mechanicType}
        onChange={(mechanicType) => onChange({
          mechanicType,
          buyQuantity: '',
          getQuantity: '',
          discountPercent: '',
          legacyMechanic: '',
        })}
        options={[
          { value: 'buy_get_free', label: 'Buy [items], get [free items]' },
          { value: 'buy_get_percent', label: 'Buy [items], get [discount %] off one item' },
          { value: 'percent_off', label: 'Get [discount %] off every item' },
        ]}
        placeholder="Choose a mechanic"
        invalid={Boolean(error)}
      />
      {!form.legacyMechanic && (
        <p className={hintClass}>Choose an offer, then enter the bracketed values below.</p>
      )}
      {form.legacyMechanic && !form.mechanicType && (
        <p className={hintClass}>Previously saved as “{form.legacyMechanic}”. Choose a supported mechanic to edit it.</p>
      )}
      {form.mechanicType && (
        <div className={cn('mt-3 grid gap-3 sm:grid-cols-2', !needsBuy && 'sm:grid-cols-1 sm:max-w-xs')}>
          {needsBuy && (
            <label>
              <span className={labelClass}>Items to buy</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.buyQuantity}
                onChange={(event) => onChange({ buyQuantity: event.target.value })}
                className={inputClass}
                placeholder="e.g. 2"
              />
            </label>
          )}
          {form.mechanicType === 'buy_get_free' && (
            <label>
              <span className={labelClass}>Free items</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.getQuantity}
                onChange={(event) => onChange({ getQuantity: event.target.value })}
                className={inputClass}
                placeholder="e.g. 1"
              />
            </label>
          )}
          {needsPercent && (
            <label>
              <span className={labelClass}>
                {needsBuy ? 'Discount on one item' : 'Discount on every item'}
              </span>
              <span className="flex">
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={form.discountPercent}
                  onChange={(event) => onChange({ discountPercent: event.target.value })}
                  className={cn(inputClass, 'rounded-r-none')}
                  placeholder="e.g. 30"
                />
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-lavander bg-cream px-3 text-sm text-deep-violet-blue/65" aria-hidden="true">
                  %
                </span>
              </span>
            </label>
          )}
        </div>
      )}
      {estimatedDiscount !== null && (
        <p className={hintClass}>
          Average discount for revenue estimates: {Number(estimatedDiscount.toFixed(2))}% per item.
        </p>
      )}
      <FieldError message={error} />
    </fieldset>
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
        placeholder="e.g. $3 off $30"
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
 * to period_start / period_end; for Monthly promotions a month picker
 * fills them with that month's first and last day. period_label is
 * optional free text.
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
  const selectedStores = storeOptions.filter((store) =>
    (form.selectedStoreCodes || []).map(String).includes(String(store.store_code)),
  );
  // Pack and carton Monthly both run for a whole calendar month.
  const isMonthly = form.promoType === MONTHLY_PROMO_TYPE;
  // Inline messages sit next to each field; the footer repeats the count so
  // the user standing at the submit button knows to scroll up.
  const errorCount = Object.values(errors).filter(Boolean).length;

  /**
   * Patch one or more form fields. Ignored while a submit is in flight:
   * the payload has already been built from `form`, and a change that
   * landed mid-request would be silently lost when the form resets.
   *
   * @param {object} patch
   */
  const patchForm = (patch) => {
    if (isSubmitting) return;
    onChange({
      ...form,
      ...patch,
    });
  };

  /**
   * Set the ticked retailers, dropping any picked store that no longer
   * belongs to one of them.
   *
   * @param {string[]} retailerIds
   */
  const setRetailers = (retailerIds) => {
    patchForm({
      selectedRetailerIds: retailerIds,
      selectedStoreCodes: storeCodesAllowedForRetailers(retailerIds),
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


  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className={cn(
        'relative rounded-lg border border-lavander bg-white shadow-sm',
        isFlashing && 'animate-edit-flash',
      )}
      onAnimationEnd={(event) => {
        // Child widgets have their own animations; only react to ours.
        if (event.animationName === 'edit-flash') setSeenFlashKey(flashKey);
      }}
    >
      {/* Sits above the disabled fieldset while the request is in flight. */}
      {isSubmitting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{isEdit ? 'Saving changes…' : 'Creating promotion…'}</p>
        </div>
      )}
      {/* ==== Header ==== */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-lavander py-3 pl-4 pr-12">
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

      {/* A disabled fieldset locks every native control inside it, so the
          values cannot change between building the payload and the reset. */}
      <fieldset
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="min-w-0 divide-y divide-lavander"
      >
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
              <MultiSelectDropdown
                ariaLabel="Retailers"
                allLabel="All retailers"
                noneMeansAll={false}
                options={retailerOptions.map((retailer) => ({
                  value: String(retailer.retailer_id),
                  label: retailerLabel(retailer.retailer_name),
                }))}
                values={(form.selectedRetailerIds || []).map(String)}
                onChange={setRetailers}
                placeholder={
                  isLoadingRetailers ? 'Loading retailers…' : 'Select retailers'
                }
                disabled={isLoadingRetailers || retailerOptions.length === 0}
                invalid={Boolean(errors.retailerScope)}
              />
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
              {/* The store code is the hint, so the search finds a store by
                  name or code. */}
              <MultiSelectDropdown
                ariaLabel="Stores"
                allLabel="All stores"
                noneMeansAll={false}
                options={storeOptions.map((store) => ({
                  value: String(store.store_code),
                  label: store.store_name,
                  hint: String(store.store_code),
                }))}
                values={(form.selectedStoreCodes || []).map(String)}
                onChange={(selectedStoreCodes) => patchForm({ selectedStoreCodes })}
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
              />
              {storesError && <p className={errorClass}>{storesError}</p>}
              {!isLoadingStores && !storesError && (
                // Always rendered so the line does not vanish (and shift the
                // form) the moment a retailer is ticked.
                <p className={hintClass}>
                  {storesNeedRetailer
                    ? 'Stores appear after you pick retailers.'
                    : storeOptions.length === 0
                      ? 'No stores for the selected retailers.'
                      : `${selectedStores.length} of ${storeOptions.length} ${storeOptions.length === 1 ? 'store' : 'stores'} selected.`}
                </p>
              )}
              <FieldError message={errors.storeName} />
            </fieldset>
          </div>
        </FormSection>

        {/* ==== 3. What ==== */}
        <FormSection
          step={2}
          title="Offer"
          hint="The kind of promotion and what the shopper gets."
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <fieldset>
              <legend className={labelClass}>
                Promo type
                <RequiredMark />
              </legend>
              <SelectDropdown
                ariaLabel="Promo type"
                value={form.promoType}
                onChange={(promoType) => patchForm(promoTypePatch(form, promoType))}
                options={PROMO_TYPES}
                placeholder="Select promo type"
                invalid={Boolean(errors.promoType)}
              />
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
              form={form}
              onChange={patchForm}
              error={errors.promotionMechanic}
            />

            <VoucherField
              value={form.voucher}
              onChange={(voucher) => patchForm({ voucher })}
              error={errors.voucher}
            />
          </div>
        </FormSection>

        {/* ==== 3. When ==== */}
        <FormSection
          step={3}
          title="Period"
          hint="The dates the promotion runs. The label is a name for your own reference."
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
            {isMonthly ? (
              <fieldset>
                <legend className={labelClass}>
                  Month
                  <RequiredMark />
                </legend>
                <MonthPicker
                  value={form.periodStart}
                  onChange={(period) => patchForm(period)}
                  invalid={Boolean(errors.periodStart)}
                />
                {form.periodStart && form.periodEnd && (
                  <p className={hintClass}>
                    {formatDate(form.periodStart)} – {formatDate(form.periodEnd)}
                  </p>
                )}
                <FieldError message={errors.periodStart} />
              </fieldset>
            ) : (
              <DateRangePicker
                className="contents"
                start={form.periodStart}
                end={form.periodEnd}
                onStartChange={(periodStart) => patchForm({ periodStart })}
                onEndChange={(periodEnd) => patchForm({ periodEnd })}
                required
                disabled={isSubmitting}
                startError={errors.periodStart}
                endError={errors.periodEnd}
                labelClassName={labelClass}
                inputClassName="py-1.5"
              />
            )}

            <PeriodLabelField
              value={form.periodLabel}
              onChange={(periodLabel) => patchForm({ periodLabel })}
              error={errors.periodLabel}
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
            <MultiSelectDropdown
              ariaLabel="SKU range"
              allLabel="All SKU ranges"
              noneMeansAll={false}
              options={skuRangeOptions.map((range) => ({ value: range, label: range }))}
              values={form.skuRanges}
              onChange={(skuRanges) => patchForm({ skuRanges })}
              placeholder={
                isLoadingSkuRanges ? 'Loading SKU ranges…' : 'Select SKU ranges'
              }
              disabled={isLoadingSkuRanges || skuRangeOptions.length === 0}
              invalid={Boolean(errors.skuRanges)}
            />
            {skuRangesError && <p className={errorClass}>{skuRangesError}</p>}
            {!isLoadingSkuRanges && !skuRangesError && skuRangeOptions.length === 0 && (
              <p className={hintClass}>No SKU ranges yet.</p>
            )}
            <FieldError message={errors.skuRanges} />
          </fieldset>
        </FormSection>
      </fieldset>

      {/* ==== Actions ==== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <p className="text-xs text-red-700" role="status">
          {errorCount > 0 &&
            `Fix ${errorCount} highlighted ${errorCount === 1 ? 'field' : 'fields'} above.`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-deep-violet-blue/30 bg-white px-4 py-1.5 text-sm font-medium text-deep-violet-blue transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
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
