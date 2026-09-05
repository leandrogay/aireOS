export const PROMO_TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'side_offer', label: 'Side offer' },
  { value: 'carton', label: 'Carton' },
  { value: 'bundle', label: 'Bundle' },
];

export const STORE_FORMATS = ['Hyper', 'Super', 'Finest', 'Unity'];

/**
 * Recurrence is UI-only until the promotions table has a column for it.
 */
export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const SKU_RANGES = ['Flagship', 'Ultra Pants', 'Ultra Tape'];

export const PROMO_MECHANICS = [
  'Buy 2 Get 25% Off',
  'Buy 2 Get 30% Off',
  'Buy 2 Get 1 Free',
  '30% Off',
  '25% Off',
  '20% Off',
  'No Promo',
  '27% Off',
  '33% Off',
];

export const MONTH_OPTIONS = [
  { value: '1', label: 'Jan' },
  { value: '2', label: 'Feb' },
  { value: '3', label: 'Mar' },
  { value: '4', label: 'Apr' },
  { value: '5', label: 'May' },
  { value: '6', label: 'Jun' },
  { value: '7', label: 'Jul' },
  { value: '8', label: 'Aug' },
  { value: '9', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

export const YEAR_OPTIONS = [2025, 2026, 2027, 2028];

const defaultMonth = String(new Date().getMonth() + 1);
const defaultYear = YEAR_OPTIONS.includes(new Date().getFullYear())
  ? new Date().getFullYear()
  : YEAR_OPTIONS[0];

export const EMPTY_PROMOTION_FORM = {
  offerKind: 'monthly',
  selectedRetailerIds: [],
  selectedStoreCodes: [],
  storeFormats: [],
  recurrence: 'none',
  periodMonth: defaultMonth,
  periodYear: defaultYear,
  promoType: 'regular',
  promotionMechanic: PROMO_MECHANICS[0],
  voucherOff: '',
  voucherOn: '',
  skuRanges: [],
  weeklyMonth: defaultMonth,
  weeklyYear: defaultYear,
  weeklyWeekStart: '',
};

/**
 * Format a Date as YYYY-MM-DD for date inputs and API payloads.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * First Thursday of a calendar year.
 *
 * Weekly side offers run Thursday–Wednesday, matching the client calendar
 * (not ISO Monday–Sunday weeks).
 *
 * @param {number} year
 * @returns {Date}
 */
export function firstThursdayOfYear(year) {
  const date = new Date(year, 0, 1);
  const offset = (4 - date.getDay() + 7) % 7;
  date.setDate(1 + offset);
  return date;
}

/**
 * Thursday–Wednesday weeks whose Thursday start falls in the given month.
 *
 * Week 1 of the year is the first Thursday of that year. Labels include
 * the start and end dates so staff can pick "Week 1 / 2 / 3 / 4 / 5".
 *
 * @param {number} year
 * @param {number} month 1–12
 * @returns {Array<{ weekNumber: number, weekStart: string, weekEnd: string, optionLabel: string, periodLabel: string }>}
 */
export function getThursdayWeeksInMonth(year, month) {
  if (!year || !month) return [];

  const weeks = [];
  const start = firstThursdayOfYear(year);
  let weekNumber = 1;

  while (start.getFullYear() === year) {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    if (start.getMonth() + 1 === Number(month)) {
      const weekStart = formatYmd(start);
      const weekEnd = formatYmd(end);
      weeks.push({
        weekNumber,
        weekStart,
        weekEnd,
        optionLabel: `Week ${weeks.length + 1} (${weekStart} – ${weekEnd})`,
        periodLabel: `W${weekNumber}-${year}`,
      });
    }

    start.setDate(start.getDate() + 7);
    weekNumber += 1;
    if (weekNumber > 54) break;
  }

  return weeks;
}

/**
 * First and last calendar day of a month, as YYYY-MM-DD.
 *
 * These map to promotions.period_start and promotions.period_end.
 * Example: January 2026 → 2026-01-01 and 2026-01-31.
 *
 * @param {string | number} month 1–12
 * @param {string | number} year
 * @returns {{ periodStart: string, periodEnd: string }}
 */
export function monthPeriodBounds(month, year) {
  const monthNumber = Number(month);
  const yearNumber = Number(year);

  if (!monthNumber || !yearNumber) {
    return { periodStart: '', periodEnd: '' };
  }

  const start = new Date(yearNumber, monthNumber - 1, 1);
  const end = new Date(yearNumber, monthNumber, 0);

  return {
    periodStart: formatYmd(start),
    periodEnd: formatYmd(end),
  };
}

/**
 * Build the monthly period_label as MMM-YYYY, e.g. Jan-2026.
 *
 * @param {string | number} month 1–12
 * @param {string | number} year
 * @returns {string}
 */
export function formatMonthlyPeriodLabel(month, year) {
  const match = MONTH_OPTIONS.find((item) => item.value === String(month));
  if (!match || !year) return '';
  return `${match.label}-${year}`;
}

/**
 * Build the voucher string "$8 off $80" from the two amount inputs.
 *
 * @param {string | number} offAmount
 * @param {string | number} onAmount
 * @returns {string | null}
 */
export function formatVoucher(offAmount, onAmount) {
  const off = String(offAmount ?? '').trim();
  const on = String(onAmount ?? '').trim();
  if (!off && !on) return null;
  return `$${off} off $${on}`;
}

/**
 * Human-readable label for a stored promo_type enum value.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function promoTypeLabel(value) {
  const match = PROMO_TYPES.find((item) => item.value === value);
  return match ? match.label : value || '—';
}

/**
 * Format a backend date value for the overview list.
 *
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
export function formatPromoDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/**
 * Retailer checkboxes from GET /api/promotions/retailers only.
 *
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @returns {Array<{ retailer_id: number, retailer_name: string }>}
 */
export function retailerDropdownOptions(retailers) {
  return [...(retailers || [])].sort(
    (left, right) => Number(left.retailer_id) - Number(right.retailer_id),
  );
}

/**
 * Resolve which retailer names will receive a monthly promotion row.
 *
 * Uses the ticked retailer checkboxes. "All retailers" is only a shortcut
 * that ticks every box — the POST still sends one row per ticked name.
 *
 * @param {object} form
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @returns {string[]}
 */
export function resolveRetailerTargets(form, retailers) {
  const options = retailerDropdownOptions(retailers);
  const selectedIds = new Set((form.selectedRetailerIds || []).map(String));

  return options
    .filter((retailer) => selectedIds.has(String(retailer.retailer_id)))
    .map((retailer) => retailer.retailer_name)
    .filter(Boolean);
}

/**
 * Whether every retailer checkbox is currently ticked.
 *
 * @param {number[] | string[]} selectedIds
 * @param {Array<{ retailer_id: number }>} options
 * @returns {boolean}
 */
export function areAllRetailersSelected(selectedIds, options) {
  if (!options.length) return false;
  const selected = new Set((selectedIds || []).map(String));
  return options.every((retailer) => selected.has(String(retailer.retailer_id)));
}

/**
 * Whether every SKU range checkbox is currently ticked.
 *
 * @param {string[]} selected
 * @returns {boolean}
 */
export function areAllSkuRangesSelected(selected) {
  if (!SKU_RANGES.length) return false;
  const picked = new Set(selected || []);
  return SKU_RANGES.every((range) => picked.has(range));
}

/**
 * Unique store-code list from GET /api/promotions/stores.
 *
 * The same code exists under each retailer (51 × 3). The checkbox
 * shows each code once; submit attaches it to the ticked retailers.
 *
 * @param {Array<{ store_code?: string, store_name?: string }>} apiStores
 * @returns {Array<{ store_code: string, store_name: string }>}
 */
export function storeCatalogOptions(apiStores = []) {
  const unique = new Map();

  for (const store of apiStores) {
    const code = store?.store_code == null ? '' : String(store.store_code).trim();
    const name = String(store?.store_name || '').trim();
    if (code && !unique.has(code)) {
      unique.set(code, { store_code: code, store_name: name || code });
    }
  }

  return [...unique.values()].sort((left, right) =>
    left.store_name.localeCompare(right.store_name),
  );
}

/**
 * Whether every store checkbox is currently ticked.
 *
 * @param {string[]} selectedCodes
 * @param {Array<{ store_code: string }>} options
 * @returns {boolean}
 */
export function areAllStoresSelected(selectedCodes, options) {
  if (!options.length) return false;
  const selected = new Set((selectedCodes || []).map(String));
  return options.every((store) => selected.has(String(store.store_code)));
}

/**
 * Whether every store-format checkbox is currently ticked.
 *
 * @param {string[]} selected
 * @returns {boolean}
 */
export function areAllStoreFormatsSelected(selected) {
  if (!STORE_FORMATS.length) return false;
  const picked = new Set(selected || []);
  return STORE_FORMATS.every((format) => picked.has(format));
}

/**
 * Resolve ticked store codes to catalog rows.
 *
 * @param {object} form
 * @param {Array<{ store_code: string, store_name: string }>} storeOptions
 * @returns {Array<{ store_code: string, store_name: string }>}
 */
export function resolveSelectedStores(form, storeOptions) {
  const selected = new Set((form.selectedStoreCodes || []).map(String));
  return storeOptions.filter((store) => selected.has(String(store.store_code)));
}

/**
 * Join ticked store formats for stores.store_format (one varchar).
 *
 * @param {string[]} selected
 * @returns {string | null}
 */
export function formatStoreFormats(selected) {
  const values = (selected || []).filter(Boolean);
  return values.length ? values.join(', ') : null;
}

/**
 * Validate the create form. Weekly side offers are UI-only and never hit
 * the API; monthly promotions must satisfy the current POST /api/promotions
 * body (retailer, store, period_start/end, promo_type).
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @param {object[]} stores
 * @returns {Record<string, string>}
 */
export function validatePromotionForm(form, retailers, stores = []) {
  const errors = {};

  if (!form.offerKind) {
    errors.offerKind = 'Choose monthly promotions or weekly side offers.';
    return errors;
  }

  if (form.offerKind === 'weekly') {
    if (!form.weeklyYear || !form.weeklyMonth) {
      errors.weeklyMonth = 'Select a month and year.';
    }
    if (!form.weeklyWeekStart) {
      errors.weeklyWeek = 'Select a week.';
    }
    if (!form.skuRanges.length) {
      errors.skuRanges = 'Select at least one SKU range.';
    }
    return errors;
  }

  const retailerNames = resolveRetailerTargets(form, retailers);
  if (retailerNames.length === 0) {
    errors.retailerScope = 'Select at least one retailer.';
  }

  const storeOptions = storeCatalogOptions(stores);
  if (!resolveSelectedStores(form, storeOptions).length) {
    errors.storeName = 'Select at least one store.';
  }

  if (!(form.storeFormats || []).length) {
    errors.storeFormats = 'Select at least one store format.';
  }

  if (!form.periodMonth || !form.periodYear) {
    errors.periodLabel = 'Select a month and year.';
  }

  if (!form.promoType) {
    errors.promoType = 'Promo type is required.';
  }

  if (!form.promotionMechanic) {
    errors.promotionMechanic = 'Select a promo mechanic.';
  }

  const off = String(form.voucherOff ?? '').trim();
  const on = String(form.voucherOn ?? '').trim();
  if ((off && !on) || (!off && on)) {
    errors.voucher = 'Enter both voucher amounts, or leave both blank.';
  }

  if (!form.skuRanges.length) {
    errors.skuRanges = 'Select at least one SKU range.';
  }

  return errors;
}

/**
 * Build the JSON body POST /api/promotions currently accepts.
 *
 * Month + year are expanded to period_start (first day) and period_end
 * (last day). store_code is a string. Ticked SKU ranges are sent as sku
 * rows whose `sku` equals the range name. Weekly side offers must not
 * call this.
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @param {{ store_name: string, store_code: string }} store
 * @returns {object}
 */
export function buildPromotionPayload(form, store) {
  const { periodStart, periodEnd } = monthPeriodBounds(form.periodMonth, form.periodYear);

  return {
    store_name: String(store.store_name || '').trim(),
    store_code: String(store.store_code || '').trim(),
    store_format: formatStoreFormats(form.storeFormats),
    period_start: periodStart,
    period_end: periodEnd,
    period_label: formatMonthlyPeriodLabel(form.periodMonth, form.periodYear) || null,
    promo_type: form.promoType,
    promotion_mechanic: form.promotionMechanic || null,
    voucher: formatVoucher(form.voucherOff, form.voucherOn),
    skus: form.skuRanges.map((range) => ({
      sku: range,
      sku_range: range,
    })),
  };
}
