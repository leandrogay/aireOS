'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import {
  EMPTY_PROMOTION_FORM,
  MONTH_OPTIONS,
  PROMO_MECHANICS,
  PROMO_TYPES,
  YEAR_OPTIONS,
  areAllRetailersSelected,
  areAllSkuRangesSelected,
  areAllStoresSelected,
  formatMonthlyPeriodLabel,
  getThursdayWeeksInMonth,
  monthPeriodBounds,
  resolveSelectedPeriods,
  retailerDropdownOptions,
  storeCatalogOptions,
  storesForRetailerIds,
} from '@/app/utils/promotionForm';

const inputClass =
  'w-full rounded-md border border-lavander bg-cream px-2.5 py-1 text-sm text-deep-violet-blue focus:border-violet focus:outline-none';
const numberInputClass =
  'w-16 min-w-0 rounded-md border border-lavander bg-cream px-2 py-1 text-sm text-deep-violet-blue focus:border-violet focus:outline-none';
const lockedInputClass =
  'w-full cursor-default rounded-md border border-lavander bg-lavander/70 px-2.5 py-1 text-sm text-deep-violet-blue/80';
const labelClass = 'mb-0.5 block text-xs font-medium text-deep-violet-blue';
const gridClass = 'grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4';
const errorClass = 'mt-0.5 text-xs text-red-700';
const checkRowClass =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';
const segmentTriggerClass =
  'rounded-full px-3 py-0.5 text-xs text-deep-violet-blue/55 data-active:border data-active:border-deep-violet-blue/25 data-active:bg-white data-active:text-deep-violet-blue data-active:shadow-sm';

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
 * Compact AO4-1 create / edit form.
 *
 * Monthly is the default view. Retailers and stores are independent
 * checkbox lists. A store such as Sun Plaza (355) can be saved under
 * FairPrice Offline, FairPrice Online, or NHG depending on which
 * retailers are ticked. Store format stays on the stores catalog.
 * SKU ranges come from GET /api/catalog/sku-ranges. Multiple months
 * and years expand into one stored row per month × year.
 *
 * Edit locks retailer and store, and allows period, type, mechanic,
 * voucher, and SKU.
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
  onCancel,
}) {
  const isEdit = mode === 'edit';
  const retailerOptions = retailerDropdownOptions(retailers);
  const scopedStores = isEdit
    ? stores
    : storesForRetailerIds(stores, form.selectedRetailerIds);
  const storeOptions = storeCatalogOptions(scopedStores);
  const storesNeedRetailer = !isEdit && !(form.selectedRetailerIds || []).length;
  const allRetailersSelected = areAllRetailersSelected(
    form.selectedRetailerIds,
    retailerOptions,
  );
  const allStoresSelected = areAllStoresSelected(form.selectedStoreCodes, storeOptions);
  const allSkuRangesSelected = areAllSkuRangesSelected(form.skuRanges, skuRangeOptions);
  const { periodStart, periodEnd } = monthPeriodBounds(form.periodMonth, form.periodYear);
  const selectedPeriods = resolveSelectedPeriods(form);
  const monthSummary = MONTH_OPTIONS.filter((month) =>
    (form.periodMonths || []).map(String).includes(month.value),
  )
    .map((month) => month.label)
    .join(', ');
  const yearSummary = YEAR_OPTIONS.filter((year) =>
    (form.periodYears || []).map(Number).includes(Number(year)),
  ).join(', ');
  const periodHint = selectedPeriods.length
    ? selectedPeriods.map((period) => period.periodLabel).join(', ')
    : 'Select at least one month and one year';
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
  const skuSummary = allSkuRangesSelected ? 'All SKU ranges' : form.skuRanges.join(', ');
  const lockedRetailerName =
    retailerOptions.find((retailer) =>
      (form.selectedRetailerIds || []).map(String).includes(String(retailer.retailer_id)),
    )?.retailer_name || '';
  const lockedStoreName =
    storeOptions.find((store) =>
      (form.selectedStoreCodes || []).map(String).includes(String(store.store_code)),
    )?.store_name || form.selectedStoreCodes?.[0] || '';

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
   * Tick or untick one create-form month. There is no Select all.
   *
   * @param {string} month
   */
  const togglePeriodMonth = (month) => {
    const value = String(month);
    const selected = (form.periodMonths || []).map(String);
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    patchForm({ periodMonths: next });
  };

  /**
   * Tick or untick one create-form year. There is no Select all.
   *
   * @param {number} year
   */
  const togglePeriodYear = (year) => {
    const value = Number(year);
    const selected = (form.periodYears || []).map(Number);
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    patchForm({ periodYears: next });
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
      className="rounded-lg border border-lavander bg-white p-3 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl text-deep-violet-blue">
          {isEdit ? 'Edit promotion' : 'Create promotion'}
        </h2>
        <p className="text-xs text-deep-violet-blue/70">
          Required fields <span className="text-red-700">*</span>
        </p>
      </div>

      {isEdit && (
        <p className="mb-2 text-[11px] leading-tight text-deep-violet-blue/70">
          Retailer and store cannot be changed. Period, type, mechanic, voucher, and SKU can.
        </p>
      )}

      {!isEdit && (
      <Tabs
        value={form.offerKind}
        onValueChange={setOfferKind}
        className="mb-2"
      >
        <TabsList className="h-8 rounded-full bg-lavander p-0.5">
          <TabsTrigger value="monthly" className={segmentTriggerClass}>
            Monthly promotion
          </TabsTrigger>
          <TabsTrigger value="weekly" className={segmentTriggerClass}>
            Weekly side offers
          </TabsTrigger>
        </TabsList>
      </Tabs>
      )}

      {isEdit && (
        <div className={gridClass}>
          <label>
            <span className={labelClass}>Retailer</span>
            <input
              readOnly
              value={lockedRetailerName}
              className={lockedInputClass}
              aria-readonly="true"
            />
            <FieldError message={errors.retailerScope} />
          </label>

          <label>
            <span className={labelClass}>Store</span>
            <input
              readOnly
              value={lockedStoreName}
              className={lockedInputClass}
              aria-readonly="true"
            />
            <FieldError message={errors.storeName} />
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
            <p className="mt-0.5 text-[10px] leading-tight text-deep-violet-blue/55">
              {periodStart && periodEnd
                ? `${formatMonthlyPeriodLabel(form.periodMonth, form.periodYear)}`
                : 'MMM-YYYY'}
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

          <div>
            <span className={labelClass}>Voucher</span>
            <div className="flex items-center gap-1 text-sm text-deep-violet-blue">
              <span>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOff}
                onChange={(event) => patchForm({ voucherOff: event.target.value })}
                className={numberInputClass}
                placeholder="8"
              />
              <span className="shrink-0">off $</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOn}
                onChange={(event) => patchForm({ voucherOn: event.target.value })}
                className={numberInputClass}
                placeholder="80"
              />
            </div>
            <FieldError message={errors.voucher} />
          </div>

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
                  {range}
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
      )}

      {!isEdit && form.offerKind === 'monthly' && (
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
                  {retailer.retailer_name}
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
                    ? 'Select a retailer first'
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
                        {store.store_name}
                        <span className="ml-auto font-mono text-[10px] text-deep-violet-blue/60">
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
                Stores appear after you pick a retailer.
              </p>
            )}
            {!isLoadingStores && !storesError && !storesNeedRetailer && storeOptions.length === 0 && (
              <p className="mt-0.5 text-[10px] text-deep-violet-blue/60">
                No stores for this retailer.
              </p>
            )}
            <FieldError message={errors.storeName} />
          </fieldset>

          <fieldset>
            <legend className={labelClass}>
              Month <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown summary={monthSummary} placeholder="Select months">
              {MONTH_OPTIONS.map((month) => (
                <label key={month.value} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={(form.periodMonths || []).map(String).includes(month.value)}
                    onChange={() => togglePeriodMonth(month.value)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {month.label}
                </label>
              ))}
            </CheckboxDropdown>
          </fieldset>

          <fieldset>
            <legend className={labelClass}>
              Year <span className="text-red-700">*</span>
            </legend>
            <CheckboxDropdown summary={yearSummary} placeholder="Select years">
              {YEAR_OPTIONS.map((year) => (
                <label key={year} className={checkRowClass}>
                  <input
                    type="checkbox"
                    checked={(form.periodYears || []).map(Number).includes(Number(year))}
                    onChange={() => togglePeriodYear(year)}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  {year}
                </label>
              ))}
            </CheckboxDropdown>
            <p className="mt-0.5 text-[10px] leading-tight text-deep-violet-blue/55">
              {periodHint}
            </p>
            <FieldError message={errors.periodLabel} />
          </fieldset>

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

          <div>
            <span className={labelClass}>Voucher</span>
            <div className="flex items-center gap-1 text-sm text-deep-violet-blue">
              <span>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOff}
                onChange={(event) => patchForm({ voucherOff: event.target.value })}
                className={numberInputClass}
                placeholder="8"
              />
              <span className="shrink-0">off $</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.voucherOn}
                onChange={(event) => patchForm({ voucherOn: event.target.value })}
                className={numberInputClass}
                placeholder="80"
              />
            </div>
            <FieldError message={errors.voucher} />
          </div>

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
                  {range}
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
      )}

      {!isEdit && form.offerKind === 'weekly' && (
        <div className={gridClass}>
          <p className="sm:col-span-2 lg:col-span-4 text-[11px] leading-tight text-deep-violet-blue/70">
            Weekly side offers are UI-only until a weekly backend exists.
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

          <label>
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
                  {range}
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
      )}

      {(isEdit || form.offerKind) && (
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
                : form.offerKind === 'weekly'
                  ? 'Record weekly offer (UI only)'
                  : 'Create monthly promotion'}
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
    periodMonths: [...EMPTY_PROMOTION_FORM.periodMonths],
    periodYears: [...EMPTY_PROMOTION_FORM.periodYears],
    skuRanges: [],
  };
}
