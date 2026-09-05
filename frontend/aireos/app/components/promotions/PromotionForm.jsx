'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import {
  EMPTY_PROMOTION_FORM,
  MONTH_OPTIONS,
  PROMO_MECHANICS,
  PROMO_TYPES,
  RECURRENCE_OPTIONS,
  SKU_RANGES,
  STORE_FORMATS,
  YEAR_OPTIONS,
  areAllRetailersSelected,
  areAllSkuRangesSelected,
  areAllStoreFormatsSelected,
  areAllStoresSelected,
  formatMonthlyPeriodLabel,
  getThursdayWeeksInMonth,
  monthPeriodBounds,
  retailerDropdownOptions,
  storeCatalogOptions,
} from '@/app/utils/promotionForm';

const inputClass =
  'w-full rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-sm text-deep-violet-blue focus:border-violet focus:outline-none';
const labelClass = 'mb-1 block text-xs font-medium text-deep-violet-blue';
const errorClass = 'mt-1 text-xs text-red-700';
const checkRowClass =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-deep-violet-blue hover:bg-cream';
const segmentTriggerClass =
  'rounded-full px-4 py-1 text-sm text-deep-violet-blue/55 data-active:border data-active:border-deep-violet-blue/25 data-active:bg-white data-active:text-deep-violet-blue data-active:shadow-sm';

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
 * Compact AO4-1 create form.
 *
 * Monthly is the default view. Retailers, stores, and store formats are
 * independent checkbox lists. A store such as Sun Plaza (355) can be
 * saved under FairPrice Offline, FairPrice Online, or NHG depending on
 * which retailers are ticked. Recurrence stays on the page only.
 *
 * @param {object} props
 */
export default function PromotionForm({
  form,
  onChange,
  retailers = [],
  stores = [],
  retailersError = '',
  storesError = '',
  isLoadingRetailers = false,
  isLoadingStores = false,
  isSubmitting = false,
  errors = {},
  onSubmit,
}) {
  const retailerOptions = retailerDropdownOptions(retailers);
  const storeOptions = storeCatalogOptions(stores);
  const allRetailersSelected = areAllRetailersSelected(
    form.selectedRetailerIds,
    retailerOptions,
  );
  const allStoresSelected = areAllStoresSelected(form.selectedStoreCodes, storeOptions);
  const allStoreFormatsSelected = areAllStoreFormatsSelected(form.storeFormats);
  const { periodStart, periodEnd } = monthPeriodBounds(form.periodMonth, form.periodYear);
  const weeklyWeeks = getThursdayWeeksInMonth(
    Number(form.weeklyYear),
    Number(form.weeklyMonth),
  );
  const selectedWeek = weeklyWeeks.find((week) => week.weekStart === form.weeklyWeekStart);
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
  const storeFormatSummary = allStoreFormatsSelected
    ? 'All store formats'
    : (form.storeFormats || []).join(', ');
  const allSkuRangesSelected = areAllSkuRangesSelected(form.skuRanges);
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

    patchForm({ selectedRetailerIds: next });
  };

  /**
   * Tick every retailer checkbox, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllRetailers = (checked) => {
    patchForm({
      selectedRetailerIds: checked
        ? retailerOptions.map((retailer) => String(retailer.retailer_id))
        : [],
    });
  };

  /**
   * Tick or untick one store. Stores stay independent of the retailer list.
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
   * Tick or untick one store format (Hyper / Super / Finest / Unity).
   *
   * @param {string} format
   */
  const toggleStoreFormat = (format) => {
    const selected = form.storeFormats || [];
    const next = selected.includes(format)
      ? selected.filter((item) => item !== format)
      : [...selected, format];
    patchForm({ storeFormats: next });
  };

  /**
   * Tick every store-format checkbox, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllStoreFormats = (checked) => {
    patchForm({ storeFormats: checked ? [...STORE_FORMATS] : [] });
  };

  /**
   * Tick every SKU range, or clear them all.
   *
   * @param {boolean} checked
   */
  const toggleAllSkuRanges = (checked) => {
    patchForm({ skuRanges: checked ? [...SKU_RANGES] : [] });
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

  /**
   * Switch between monthly (saved) and weekly (UI-only) without looking
   * like two equal halves of the form.
   *
   * @param {'monthly' | 'weekly'} offerKind
   */
  const setOfferKind = (offerKind) => {
    patchForm({
      offerKind,
      promoType: offerKind === 'weekly' ? 'side_offer' : 'regular',
    });
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-lg border border-lavander bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl text-deep-violet-blue">Create promotion</h2>
        <p className="text-xs text-deep-violet-blue/70">
          Required fields <span className="text-red-700">*</span>
        </p>
      </div>

      <Tabs
        value={form.offerKind}
        onValueChange={setOfferKind}
        className="mb-4"
      >
        <TabsList className="h-10 rounded-full bg-lavander p-1">
          <TabsTrigger value="monthly" className={segmentTriggerClass}>
            Monthly promotion
          </TabsTrigger>
          <TabsTrigger value="weekly" className={segmentTriggerClass}>
            Weekly side offers
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {form.offerKind === 'monthly' && (
        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset className="sm:col-span-2">
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
                  {retailer.retailer_name}
                </label>
              ))}
            </CheckboxDropdown>
            {isLoadingRetailers && (
              <p className="mt-1 text-xs text-deep-violet-blue/70">Loading retailers…</p>
            )}
            {retailersError && <p className={errorClass}>{retailersError}</p>}
            {!isLoadingRetailers && !retailersError && retailerOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-deep-violet-blue/60">
                No retailers from GET /retailers yet.
              </p>
            )}
            <FieldError message={errors.retailerScope} />
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>
              Stores <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown
              summary={storeSummary}
              placeholder={isLoadingStores ? 'Loading stores…' : 'Select stores'}
              disabled={isLoadingStores || storeOptions.length === 0}
            >
              <label className={`${checkRowClass} font-medium`}>
                <input
                  type="checkbox"
                  checked={allStoresSelected}
                  onChange={(event) => toggleAllStores(event.target.checked)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                All stores
              </label>
              {storeOptions.map((store) => (
                <label key={store.store_code} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={(form.selectedStoreCodes || [])
                      .map(String)
                      .includes(String(store.store_code))}
                    onChange={() => toggleStore(store.store_code)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {store.store_name}
                  <span className="ml-auto font-mono text-[10px] text-deep-violet-blue/60">
                    {store.store_code}
                  </span>
                </label>
              ))}
            </CheckboxDropdown>
            {isLoadingStores && (
              <p className="mt-1 text-xs text-deep-violet-blue/70">Loading stores…</p>
            )}
            {storesError && <p className={errorClass}>{storesError}</p>}
            {!isLoadingStores && !storesError && storeOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-deep-violet-blue/60">
                No stores from GET /stores yet.
              </p>
            )}
            <FieldError message={errors.storeName} />
          </fieldset>

          <fieldset>
            <legend className={labelClass}>
              Store format <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown summary={storeFormatSummary} placeholder="Select store formats">
              <label className={`${checkRowClass} font-medium`}>
                <input
                  type="checkbox"
                  checked={allStoreFormatsSelected}
                  onChange={(event) => toggleAllStoreFormats(event.target.checked)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                All store formats
              </label>
              {STORE_FORMATS.map((format) => (
                <label key={format} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={(form.storeFormats || []).includes(format)}
                    onChange={() => toggleStoreFormat(format)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {format}
                </label>
              ))}
            </CheckboxDropdown>
            <FieldError message={errors.storeFormats} />
          </fieldset>

          <label>
            <span className={labelClass}>Recurrence</span>
            <select
              value={form.recurrence}
              onChange={(event) => patchForm({ recurrence: event.target.value })}
              className={inputClass}
            >
              {RECURRENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
              Collected here only. Connect it after the backend adds recurrence.
            </p>
          </label>

          <label>
            <span className={labelClass}>
              Month <span className="text-red-700">*</span>
            </span>
            <select
              value={form.periodMonth}
              onChange={(event) => patchForm({ periodMonth: event.target.value })}
              className={inputClass}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className={labelClass}>
              Year <span className="text-red-700">*</span>
            </span>
            <select
              value={form.periodYear}
              onChange={(event) => patchForm({ periodYear: event.target.value })}
              className={inputClass}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
              {periodStart && periodEnd
                ? `${formatMonthlyPeriodLabel(form.periodMonth, form.periodYear)} · ${periodStart} to ${periodEnd}`
                : 'Saved as MMM-YYYY; dates fill from this month'}
            </p>
            <FieldError message={errors.periodLabel} />
          </label>

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
              Promo mechanic <span className="text-red-700">*</span>
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

          <div className="sm:col-span-2">
            <span className={labelClass}>Voucher</span>
            <div className="flex items-center gap-2 text-sm text-deep-violet-blue">
              <span>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOff}
                onChange={(event) => patchForm({ voucherOff: event.target.value })}
                className={`${inputClass} w-20`}
                placeholder="8"
              />
              <span>off $</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOn}
                onChange={(event) => patchForm({ voucherOn: event.target.value })}
                className={`${inputClass} w-24`}
                placeholder="80"
              />
            </div>
            <FieldError message={errors.voucher} />
          </div>

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>
              SKU range <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown summary={skuSummary} placeholder="Select SKU ranges">
              <label className={`${checkRowClass} font-medium`}>
                <input
                  type="checkbox"
                  checked={allSkuRangesSelected}
                  onChange={(event) => toggleAllSkuRanges(event.target.checked)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                All SKU ranges
              </label>
              {SKU_RANGES.map((range) => (
                <label key={range} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={form.skuRanges.includes(range)}
                    onChange={() => toggleSkuRange(range)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {range}
                </label>
              ))}
            </CheckboxDropdown>
            <FieldError message={errors.skuRanges} />
          </fieldset>
        </div>
      )}

      {form.offerKind === 'weekly' && (
        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <p className="sm:col-span-2 lg:col-span-4 rounded-md border border-violet bg-lavander px-3 py-2 text-xs text-deep-violet-blue">
            Weekly side offers are collected here only. They are not saved until the weekly backend table exists.
          </p>

          <label>
            <span className={labelClass}>
              Month <span className="text-red-700">*</span>
            </span>
            <select
              value={form.weeklyMonth}
              onChange={(event) => patchForm({ weeklyMonth: event.target.value, weeklyWeekStart: '' })}
              className={inputClass}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
            <FieldError message={errors.weeklyMonth} />
          </label>

          <label>
            <span className={labelClass}>
              Year <span className="text-red-700">*</span>
            </span>
            <select
              value={form.weeklyYear}
              onChange={(event) => patchForm({ weeklyYear: event.target.value, weeklyWeekStart: '' })}
              className={inputClass}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="sm:col-span-2">
            <span className={labelClass}>
              Week <span className="text-red-700">*</span>
            </span>
            <select
              value={form.weeklyWeekStart}
              onChange={(event) => patchForm({ weeklyWeekStart: event.target.value })}
              className={inputClass}
              disabled={!weeklyWeeks.length}
            >
              <option value="">{weeklyWeeks.length ? 'Select week' : 'Pick month and year first'}</option>
              {weeklyWeeks.map((week) => (
                <option key={week.weekStart} value={week.weekStart}>
                  {week.optionLabel}
                </option>
              ))}
            </select>
            {selectedWeek && (
              <p className="mt-0.5 text-[11px] text-deep-violet-blue/60">
                Stored later as {selectedWeek.periodLabel} ({selectedWeek.weekStart} – {selectedWeek.weekEnd})
              </p>
            )}
            <FieldError message={errors.weeklyWeek} />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>
              SKU range <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown summary={skuSummary} placeholder="Select SKU ranges">
              <label className={`${checkRowClass} font-medium`}>
                <input
                  type="checkbox"
                  checked={allSkuRangesSelected}
                  onChange={(event) => toggleAllSkuRanges(event.target.checked)}
                  className="size-3.5 accent-deep-violet-blue"
                />
                All SKU ranges
              </label>
              {SKU_RANGES.map((range) => (
                <label key={range} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={form.skuRanges.includes(range)}
                    onChange={() => toggleSkuRange(range)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {range}
                </label>
              ))}
            </CheckboxDropdown>
            <FieldError message={errors.skuRanges} />
          </fieldset>
        </div>
      )}

      {form.offerKind && (
        <div className="mt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? 'Saving…'
              : form.offerKind === 'weekly'
                ? 'Record weekly offer (UI only)'
                : 'Create monthly promotion'}
          </button>
        </div>
      )}
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
    storeFormats: [],
    skuRanges: [],
  };
}
