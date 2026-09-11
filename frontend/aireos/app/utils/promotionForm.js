export const PROMO_TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'side_offer', label: 'Side offer' },
  { value: 'carton', label: 'Carton' },
  { value: 'bundle', label: 'Bundle' },
];

export const PROMO_MECHANICS = [
  'No Promo',
  '27% Off',
  '25% Off',
  '20% Off',
  '30% Off',
  '33% Off',
  'Buy 2 Get 25% Off',
  'Buy 2 Get 30% Off',
  'Buy 2 Get 1 Free',
];

export const EMPTY_PROMOTION_FORM = {
  selectedRetailerIds: [],
  selectedStoreCodes: [],
  periodStart: '',
  periodEnd: '',
  periodLabel: '',
  promoType: 'regular',
  promotionMechanic: PROMO_MECHANICS[0],
  voucher: '',
  skuRanges: [],
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
 * Trim period_label for the API. Blank becomes null.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function formatPeriodLabel(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * The one start/end range from the form, if both dates are valid.
 *
 * Maps to promotions.period_start and promotions.period_end. End must
 * be on or after start. period_label is optional free text.
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @returns {Array<{ periodStart: string, periodEnd: string, periodLabel: string | null }>}
 */
export function resolveSelectedPeriods(form) {
  const periodStart = String(form.periodStart || '').trim();
  const periodEnd = String(form.periodEnd || '').trim();
  if (!periodStart || !periodEnd || periodEnd < periodStart) return [];

  return [
    {
      periodStart,
      periodEnd,
      periodLabel: formatPeriodLabel(form.periodLabel),
    },
  ];
}

/**
 * Trim voucher text for the API. Blank becomes null.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function formatVoucher(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Distinct sku_range labels from GET /api/promotions.skus.
 * A promotion links many product SKUs in a range, so the UI
 * shows each range once.
 *
 * @param {Array<{ sku?: string, sku_range?: string }>} skus
 * @returns {string[]}
 */
export function uniqueSkuRangeLabels(skus = []) {
  return [
    ...new Set(
      (skus || [])
        .map((item) => String(item?.sku_range || item?.sku || '').trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Prefill the create/edit form from one GET /api/promotions row.
 *
 * @param {object} promotion
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @returns {typeof EMPTY_PROMOTION_FORM}
 */
export function formFromPromotion(promotion, retailers = []) {
  const retailer = retailerDropdownOptions(retailers).find(
    (item) => item.retailer_name === promotion.retailer,
  );
  const skuRanges = uniqueSkuRangeLabels(promotion.skus);

  return {
    ...EMPTY_PROMOTION_FORM,
    selectedRetailerIds: retailer ? [String(retailer.retailer_id)] : [],
    selectedStoreCodes: promotion.store_code != null ? [String(promotion.store_code)] : [],
    periodStart: promotion.period_start ? String(promotion.period_start).slice(0, 10) : '',
    periodEnd: promotion.period_end ? String(promotion.period_end).slice(0, 10) : '',
    periodLabel: promotion.period_label ? String(promotion.period_label) : '',
    promoType: promotion.promo_type || 'regular',
    promotionMechanic: promotion.promotion_mechanic || PROMO_MECHANICS[0],
    voucher: promotion.voucher ? String(promotion.voucher) : '',
    skuRanges: skuRanges,
  };
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
 * Retailer checkboxes from GET /api/catalog/retailers only.
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
 * @param {string[]} options
 * @returns {boolean}
 */
export function areAllSkuRangesSelected(selected, options = []) {
  if (!options.length) return false;
  const picked = new Set(selected || []);
  return options.every((range) => picked.has(range));
}

/**
 * Catalog stores that belong to the ticked retailer ids.
 *
 * Each stores row has retailer_id. An empty id list means no stores,
 * so the dropdown stays empty until a retailer is chosen.
 *
 * @param {Array<{ retailer_id?: number }>} apiStores
 * @param {Array<number | string>} retailerIds
 * @returns {object[]}
 */
export function storesForRetailerIds(apiStores = [], retailerIds = []) {
  const ids = new Set((retailerIds || []).map(String).filter((id) => id && id !== 'undefined'));
  if (!ids.size) return [];
  return (apiStores || []).filter((store) => ids.has(String(store.retailer_id)));
}

/**
 * Unique store-code list from GET /api/catalog/stores, optionally already
 * filtered to one or more retailers. Store format stays on the catalog.
 *
 * @param {Array<{ store_code?: string, store_name?: string, store_format?: string }>} apiStores
 * @returns {Array<{ store_code: string, store_name: string, store_format: string | null }>}
 */
export function storeCatalogOptions(apiStores = []) {
  const unique = new Map();

  for (const store of apiStores) {
    const code = store?.store_code == null ? '' : String(store.store_code).trim();
    const name = String(store?.store_name || '').trim();
    const format = String(store?.store_format || '').trim() || null;
    if (!code) continue;

    const existing = unique.get(code);
    if (!existing) {
      unique.set(code, {
        store_code: code,
        store_name: name || code,
        store_format: format,
      });
    } else if (!existing.store_format && format) {
      existing.store_format = format;
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
 * Resolve ticked store codes to catalog rows.
 *
 * @param {object} form
 * @param {Array<{ store_code: string, store_name: string, store_format?: string | null }>} storeOptions
 * @returns {Array<{ store_code: string, store_name: string, store_format: string | null }>}
 */
export function resolveSelectedStores(form, storeOptions) {
  const selected = new Set((form.selectedStoreCodes || []).map(String));
  return storeOptions.filter((store) => selected.has(String(store.store_code)));
}

/**
 * Create POST pairs: only retailer × store rows that exist in the catalog.
 *
 * A ticked store is skipped for a retailer that does not own that
 * store_code, so create cannot insert a new stores row.
 *
 * @param {object} form
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @param {object[]} apiStores
 * @returns {Array<{ retailer: string, store: { store_name: string, store_code: string, store_format: string | null } }>}
 */
export function resolvePromotionCreatePairs(form, retailers, apiStores = []) {
  const selectedCodes = new Set((form.selectedStoreCodes || []).map(String));
  const pairs = [];

  for (const retailerName of resolveRetailerTargets(form, retailers)) {
    const retailer = retailerDropdownOptions(retailers).find(
      (item) => item.retailer_name === retailerName,
    );
    if (!retailer) continue;

    for (const store of apiStores) {
      if (String(store.retailer_id) !== String(retailer.retailer_id)) continue;
      const code = store.store_code == null ? '' : String(store.store_code).trim();
      if (!code || !selectedCodes.has(code)) continue;

      pairs.push({
        retailer: retailerName,
        store: {
          store_code: code,
          store_name: String(store.store_name || '').trim() || code,
          store_format: String(store.store_format || '').trim() || null,
        },
      });
    }
  }

  return pairs;
}

/**
 * Validate the monthly create/edit form against POST /api/promotions
 * (retailer, store, period_start/end, promo_type).
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @param {Array<{ retailer_id: number, retailer_name: string }>} retailers
 * @param {object[]} stores
 * @param {{ mode?: 'create' | 'edit' }} [options]
 * @returns {Record<string, string>}
 */
export function validatePromotionForm(form, retailers, stores = [], options = {}) {
  const errors = {};
  const mode = options.mode || 'create';

  const retailerNames = resolveRetailerTargets(form, retailers);
  if (retailerNames.length === 0) {
    errors.retailerScope = mode === 'edit' ? 'Select a retailer.' : 'Select at least one retailer.';
  } else if (mode === 'edit' && retailerNames.length !== 1) {
    errors.retailerScope = 'Select one retailer.';
  }

  const storeOptions = storeCatalogOptions(
    mode === 'edit' ? stores : storesForRetailerIds(stores, form.selectedRetailerIds),
  );
  const selectedStores = resolveSelectedStores(form, storeOptions);
  if (mode === 'edit') {
    if (!selectedStores.length) {
      errors.storeName = 'Select a store.';
    } else if (selectedStores.length !== 1) {
      errors.storeName = 'Select one store.';
    }
  } else if ((form.selectedRetailerIds || []).length) {
    if (!storeOptions.length) {
      errors.storeName = 'No stores for the selected retailer.';
    } else if (!selectedStores.length) {
      errors.storeName = 'Select at least one store.';
    }
  }

  if (!form.periodStart) {
    errors.periodStart = 'Select a start date.';
  }
  if (!form.periodEnd) {
    errors.periodEnd = 'Select an end date.';
  } else if (form.periodStart && form.periodEnd < form.periodStart) {
    errors.periodEnd = 'End date cannot be earlier than the start date.';
  }

  if (String(form.periodLabel ?? '').trim().length > 100) {
    errors.periodLabel = 'Period label must be 100 characters or fewer.';
  }

  if (!form.promoType) {
    errors.promoType = 'Promo type is required.';
  }

  if (!form.promotionMechanic) {
    errors.promotionMechanic = 'Select a promo mechanic.';
  }

  if (String(form.voucher ?? '').trim().length > 255) {
    errors.voucher = 'Voucher must be 255 characters or fewer.';
  }

  if (!form.skuRanges.length) {
    errors.skuRanges = 'Select at least one SKU range.';
  }

  return errors;
}

/**
 * Build the JSON body POST /api/promotions currently accepts.
 *
 * Dates are promotions.period_start and promotions.period_end.
 * period_label is optional free text. store_code is a string. Ticked
 * SKU ranges are sent so the backend can map existing catalog SKUs
 * into promotion_skus. This does not insert into skus or
 * promotion_skus from the frontend.
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @param {{ store_name: string, store_code: string, store_format?: string | null }} store
 * @param {{ periodStart?: string, periodEnd?: string, periodLabel?: string | null }} [period]
 * @returns {object}
 */
export function buildPromotionPayload(form, store, period) {
  const periodStart = period?.periodStart || String(form.periodStart || '').trim();
  const periodEnd = period?.periodEnd || String(form.periodEnd || '').trim();

  return {
    store_name: String(store.store_name || '').trim(),
    store_code: String(store.store_code || '').trim(),
    period_start: periodStart,
    period_end: periodEnd,
    period_label:
      period && Object.prototype.hasOwnProperty.call(period, 'periodLabel')
        ? period.periodLabel
        : formatPeriodLabel(form.periodLabel),
    promo_type: form.promoType,
    promotion_mechanic: form.promotionMechanic || null,
    voucher: formatVoucher(form.voucher),
    skus: form.skuRanges.map((range) => ({
      sku: range,
      sku_range: range,
    })),
  };
}

/**
 * PUT /api/promotions/{id} body. Same shape as create, plus retailer.
 * Retailer and store stay on the original row. Format is not sent;
 * it already lives on stores. Period, type, mechanic, voucher, and
 * SKUs come from the form.
 *
 * @param {typeof EMPTY_PROMOTION_FORM} form
 * @param {{ store_name: string, store_code: string }} store
 * @param {string} retailer
 * @param {object} [original]
 * @returns {object}
 */
export function buildUpdatePayload(form, store, retailer, original = {}) {
  const payload = {
    ...buildPromotionPayload(form, store),
    retailer: original.retailer || retailer,
  };

  payload.store_name = String(original.store_name || store.store_name || '').trim();
  payload.store_code = String(original.store_code ?? store.store_code ?? '').trim();

  return payload;
}
