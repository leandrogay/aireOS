// ============================================================
// SCENARIO SOURCE: DRAFT PROMOTIONS -- pure, no React
// ============================================================
//
// Planned promotions in the Scenario builder (Promotions Uplift design,
// Sections 6.2 and 6.4.5). Owned by the promotions side; the engine and the
// building-block files are not touched.
//
// A draft promotion:
//   {
//     id,                                   // client id, stable while the page is open
//     promotionId,                          // server id, null until first saved
//     customer, sku,                        // sku '' = all SKUs
//     promoType,                            // 'monthly' | 'side_offer' | 'bundle' | 'others'
//     mechanicKey, mechanicLabel,
//     referenceUpliftPct, referenceSource,  // the setting's value and source when chosen
//     referenceBySku,                       // all SKUs only: products whose own value differs
//     overrideUpliftPct,                    // null unless the user moved the slider
//     voucher, voucherUpliftPct,            // Yes/No, and the voucher's value when chosen
//     voucherBySku,
//     explanation,
//     startMonth, endMonth,                 // 'YYYY-MM-01', forecast months only
//     startDate, endDate,                   // side offers only: the exact days it runs ('YYYY-MM-DD'); '' = whole months
//     isActive,                             // switched on = counts on the Simulated line
//     saved,                                // the fields as last saved, null if never saved
//   }
//
// Saved and switched on/off exactly like building blocks (scenarioBlocks.js):
// edits show on the chart at once, `saved` is what Discard goes back to.
// The reference values are saved with the promotion, so Promotion Uplift
// Settings changes (including measured values replacing placeholders)
// never move a promotion already saved.
//
// Reference values are copied in when the customer, SKU or mechanic is
// chosen, so a later settings change does not quietly alter a draft.
// Uplifts are relative to an ordinary month (the model forecast), so they
// can be negative: a shallower discount than usual sells less.
//
// `resolved` below is one customer's GET /api/settings/promo-uplifts/resolved
// answer ({ anchor, uplifts, product_uplifts }), from usePromoUplifts.

import { PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { upliftDeltaCells } from '@/app/utils/scenarioEngine';

export const MIN_OVERRIDE_PCT = -20;
export const MAX_OVERRIDE_PCT = 50;
// Only a tie-breaker now: the default is the mechanic nearest 0%, see
// defaultMechanic().
export const DEFAULT_MECHANIC_KEY = 'pct_off_20';
export const VOUCHER_KEY = 'voucher';

// Side offers run weekly, so they are planned on exact dates (dayShare).
export const SIDE_OFFER_TYPE = 'side_offer';

// The pipeline's ARIMA_PLUS_XREG model already reflects promotions in the
// months it forecasts, so a promotion uplift there would count them twice
// (design Section 6.4.5). Building blocks still apply in those months.
export const MODEL_INCLUDES_PROMOS = 'tier1_arimax';

const SOURCE_LABELS = {
  placeholder: 'Placeholder',
  measured: 'Measured',
  estimate: 'Estimate',
  learned: 'Learned by model',
};

/**
 * Display label for an uplift source tag.
 *
 * @param {string} source
 */
export function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? source ?? '';
}

/**
 * Signed percentage: +4%, −6%, 0%.
 *
 * @param {number} value
 */
export function formatPct(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${number}%`;
  if (number < 0) return `−${Math.abs(number)}%`;
  return '0%';
}

/**
 * "+4%", or "+3% to +6%" when the values differ.
 *
 * @param {number[]} values
 */
export function formatPctRange(values) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? formatPct(low) : `${formatPct(low)} to ${formatPct(high)}`;
}

/**
 * The mechanic rows of a resolved set (everything but the voucher).
 *
 * @param {object | undefined} resolved
 */
export function mechanicOptions(resolved) {
  return (resolved?.uplifts ?? []).filter((row) => row.mechanic_key !== VOUCHER_KEY);
}

/**
 * The voucher row of a resolved set, or null.
 *
 * @param {object | undefined} resolved
 */
export function voucherOption(resolved) {
  return (resolved?.uplifts ?? []).find((row) => row.mechanic_key === VOUCHER_KEY) ?? null;
}

/**
 * Values a mechanic takes for an all-SKUs promotion: the customer's value
 * plus every product's own value, for showing "+3% to +6% by SKU".
 *
 * @param {object | undefined} resolved
 * @param {object} row a mechanic row from resolved.uplifts
 */
export function valuesAcrossSkus(resolved, row) {
  const own = Object.values(resolved?.product_uplifts ?? {})
    .map((values) => values[row.mechanic_key])
    .filter((value) => value != null);
  return [row.uplift_pct, ...own];
}

function valueFor(resolved, key, sku) {
  const base = (resolved?.uplifts ?? []).find((row) => row.mechanic_key === key);
  if (!base) return { value: null, source: '', bySku: {} };

  const products = resolved?.product_uplifts ?? {};
  if (sku) return { value: products[sku]?.[key] ?? base.uplift_pct, source: base.source, bySku: {} };

  const bySku = {};
  for (const [product, values] of Object.entries(products)) {
    if (values[key] != null) bySku[product] = values[key];
  }
  return { value: base.uplift_pct, source: base.source, bySku };
}

/**
 * Copy the current setting values for a promotion's customer, SKU and
 * mechanic onto it. Keeps any override; called whenever one of those three
 * changes (not on every render).
 *
 * @param {object} promotion
 * @param {object | undefined} resolved the promotion customer's resolved set
 */
export function withReferences(promotion, resolved) {
  if (!resolved) return promotion;
  const mechanic = valueFor(resolved, promotion.mechanicKey, promotion.sku);
  const voucher = valueFor(resolved, VOUCHER_KEY, promotion.sku);
  const row = mechanicOptions(resolved).find((option) => option.mechanic_key === promotion.mechanicKey);

  return {
    ...promotion,
    mechanicLabel: row?.mechanic_label ?? promotion.mechanicLabel,
    referenceUpliftPct: mechanic.value ?? promotion.referenceUpliftPct,
    referenceSource: mechanic.source || promotion.referenceSource,
    referenceBySku: mechanic.bySku,
    voucherUpliftPct: voucher.value ?? promotion.voucherUpliftPct,
    voucherBySku: voucher.bySku,
  };
}

/**
 * The mechanic a new promotion starts on: the one whose uplift for this
 * customer is nearest 0%, i.e. the customer's ordinary month. A fixed
 * "20% Off" would be -2% for a customer whose anchor is 25%, so adding a
 * promotion would drop the line before anything was chosen. Ties prefer
 * DEFAULT_MECHANIC_KEY, then the first in list order.
 *
 * @param {object | undefined} resolved
 */
export function defaultMechanic(resolved) {
  let best = null;
  for (const row of mechanicOptions(resolved)) {
    if (row.uplift_pct == null) continue;
    const distance = Math.abs(row.uplift_pct);
    const bestDistance = best ? Math.abs(best.uplift_pct) : Infinity;
    if (distance < bestDistance || (distance === bestDistance && row.mechanic_key === DEFAULT_MECHANIC_KEY)) {
      best = row;
    }
  }
  return best ?? mechanicOptions(resolved)[0] ?? null;
}

/**
 * A new promotion for the given customer/SKU, covering the first forecast
 * month, on defaultMechanic() so adding one moves the line as little as
 * possible until a mechanic is chosen. It is 0% whenever a mechanic sits
 * exactly on the anchor; with an anchor between steps (e.g. 23%) the nearest
 * one may still be +/-1%.
 *
 * @param {{ customer: string, sku: string, months: string[], resolved: object | undefined }} defaults
 */
export function newDraftPromotion({ customer = '', sku = '', months = [], resolved }) {
  const mechanic = defaultMechanic(resolved);
  const promotion = {
    id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customer,
    sku,
    promoType: PROMO_OVERLAY_TYPES[0].value,
    mechanicKey: mechanic?.mechanic_key ?? '',
    mechanicLabel: mechanic?.mechanic_label ?? '',
    referenceUpliftPct: 0,
    referenceSource: '',
    referenceBySku: {},
    overrideUpliftPct: null,
    voucher: false,
    voucherUpliftPct: 0,
    voucherBySku: {},
    explanation: '',
    startMonth: months[0] ?? '',
    endMonth: months[0] ?? '',
    startDate: '',
    endDate: '',
    promotionId: null,
    isActive: true,
    saved: null,
  };
  return withReferences(promotion, resolved);
}

/**
 * Apply a field change to one promotion, keeping its date range in order
 * (same rule as updateScenarioBlock).
 *
 * @param {object} promotion
 * @param {object} changes
 */
export function updateDraftPromotion(promotion, changes) {
  const next = { ...promotion, ...changes };
  // Only side offers (weekly) run on exact dates; every other type runs whole months.
  if (next.promoType !== SIDE_OFFER_TYPE) {
    next.startDate = '';
    next.endDate = '';
  }
  // A side offer's months follow its dates.
  if (next.startDate) next.startMonth = monthOf(next.startDate);
  if (next.endDate) next.endMonth = monthOf(next.endDate);
  if (next.startMonth && next.endMonth && next.startMonth > next.endMonth) {
    if ('startMonth' in changes) next.endMonth = next.startMonth;
    else next.startMonth = next.endMonth;
  }
  return next;
}

/**
 * The mechanic part of the uplift for one product (or the promotion's own
 * SKU): the override if set, else that product's reference.
 *
 * @param {object} promotion
 * @param {string} [product] a product_name, for all-SKUs promotions
 */
export function mechanicUpliftPct(promotion, product) {
  if (promotion.overrideUpliftPct != null) return promotion.overrideUpliftPct;
  return promotion.referenceBySku?.[product] ?? promotion.referenceUpliftPct ?? 0;
}

/**
 * Effective uplift = mechanic uplift (override or reference) + voucher
 * uplift when the voucher is Yes (design Section 6.2).
 *
 * @param {object} promotion
 * @param {string} [product]
 */
export function effectiveUpliftPct(promotion, product) {
  const voucher = promotion.voucher ? promotion.voucherBySku?.[product] ?? promotion.voucherUpliftPct ?? 0 : 0;
  return mechanicUpliftPct(promotion, product) + voucher;
}

/**
 * Every effective uplift an all-SKUs promotion can take (one per product
 * with its own value, plus the customer's).
 *
 * @param {object} promotion
 */
export function effectiveUpliftRange(promotion) {
  const products = new Set([
    ...Object.keys(promotion.referenceBySku ?? {}),
    ...Object.keys(promotion.voucherBySku ?? {}),
  ]);
  return [effectiveUpliftPct(promotion), ...[...products].map((product) => effectiveUpliftPct(promotion, product))];
}

function inPromotion(row, promotion) {
  if (row.forecast_current == null) return false;
  if (row.customer_name !== promotion.customer) return false;
  if (promotion.sku && row.product_name !== promotion.sku) return false;
  return row.month_year >= promotion.startMonth && row.month_year <= promotion.endMonth;
}

/**
 * The SKU-months inside the promotion whose Current forecast already
 * includes the promotion entered for them (ARIMA_PLUS_XREG), so no uplift is
 * added there. In the "Simulate New Promotions" view those rows have been
 * swapped (scenarioModelView.rowsForView), so this comes back empty.
 *
 * @param {object} promotion
 * @param {object[]} rows the forecast rows of the current view
 * @returns {{ count: number, months: string[] }}
 */
export function skippedModelCells(promotion, rows) {
  const months = new Set();
  let count = 0;
  for (const row of rows) {
    if (row.current_source_model === MODEL_INCLUDES_PROMOS && inPromotion(row, promotion)) {
      count += 1;
      months.add(row.month_year);
    }
  }
  return { count, months: [...months].sort() };
}

function describeTitle(promotion) {
  const label = promotion.mechanicLabel || 'Draft promotion';
  const overridden = promotion.overrideUpliftPct != null;
  if (promotion.voucher) {
    const mechanicPart = overridden
      ? `adjusted to ${formatPct(promotion.overrideUpliftPct)}`
      : `reference ${formatPct(promotion.referenceUpliftPct)}`;
    return `${label} + voucher (${mechanicPart}, voucher ${formatPct(promotion.voucherUpliftPct)})`;
  }
  if (overridden) return `${label} (adjusted to ${formatPct(promotion.overrideUpliftPct)})`;
  return label;
}

export const scenarioPromotionsSource = {
  key: 'promotions',
  itemsKey: 'promotions',
  label: 'Promotion',
  // Rows are taken one product at a time, so an all-SKUs promotion applies
  // each product's own value.
  // A promotion running part of a month counts for that share of it
  // (dayShare), the same day-weighting the anchor uses.
  deltas(promotions, rows) {
    const groups = new Map();
    for (const row of rows) {
      if (row.current_source_model === MODEL_INCLUDES_PROMOS) continue;
      const key = `${row.product_name}|${row.month_year}`;
      if (!groups.has(key)) groups.set(key, { product: row.product_name, month: row.month_year, rows: [] });
      groups.get(key).rows.push(row);
    }
    return promotions.flatMap((promotion) =>
      [...groups.values()].flatMap((group) =>
        upliftDeltaCells(
          group.rows,
          promotion,
          effectiveUpliftPct(promotion, group.product) * dayShare(promotion, group.month),
          'promotions'
        )
      )
    );
  },
  describe(promotion) {
    return {
      title: describeTitle(promotion),
      upliftLabel: formatPctRange(effectiveUpliftRange(promotion)),
      customer: promotion.customer,
      sku: promotion.sku,
      explanation: promotion.explanation,
      startMonth: promotion.startMonth,
      endMonth: promotion.endMonth,
    };
  },
};

/**
 * Outlined bands for draft promotions on the chart, one per promotion:
 * { key, startMonth, endMonth, color }, coloured by promotion type.
 * ForecastChart draws them through its `scenario.promoBands` prop.
 *
 * @param {object[]} promotions the draft's promotions
 */
export function draftPromotionBands(promotions) {
  return promotions
    .filter((promotion) => promotion.startMonth && promotion.endMonth)
    .map((promotion) => {
      const type = PROMO_OVERLAY_TYPES.find((option) => option.value === promotion.promoType) ?? PROMO_OVERLAY_TYPES[0];
      return {
        key: promotion.id,
        startMonth: promotion.startMonth,
        endMonth: promotion.endMonth,
        color: type.strokeColor ?? type.selectedBg,
      };
    });
}

// ============================================================
// SAVING (backend /api/scenario/promotions, scenarioPromotionsApi.js)
// ============================================================

// The fields a save writes; `saved` keeps a copy of exactly these.
const SAVED_FIELDS = [
  'customer',
  'sku',
  'promoType',
  'mechanicKey',
  'mechanicLabel',
  'referenceUpliftPct',
  'referenceSource',
  'referenceBySku',
  'overrideUpliftPct',
  'voucher',
  'voucherUpliftPct',
  'voucherBySku',
  'explanation',
  'startMonth',
  'endMonth',
  'startDate',
  'endDate',
  'isActive',
];

function savedFieldsOf(promotion) {
  return Object.fromEntries(SAVED_FIELDS.map((field) => [field, promotion[field]]));
}

function sameValue(a, b) {
  // The per-SKU maps are objects; everything else is a primitive.
  return typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : a === b;
}

/**
 * True when the promotion was never saved or differs from its saved copy.
 *
 * @param {object} promotion
 */
export function hasUnsavedPromotionChanges(promotion) {
  if (!promotion.saved) return true;
  return SAVED_FIELDS.some((field) => !sameValue(promotion[field], promotion.saved[field]));
}

/**
 * The promotion as last saved, or null for one that was never saved
 * (Discard then removes it).
 *
 * @param {object} promotion
 */
export function discardPromotionChanges(promotion) {
  if (!promotion.saved) return null;
  return { ...promotion, ...promotion.saved };
}

/**
 * What a promotion needs before it can be saved; null when it is ready.
 *
 * @param {object} promotion
 */
export function validateScenarioPromotion(promotion) {
  if (!promotion.customer) return 'Choose a customer.';
  if (!promotion.sku) return 'Choose a single SKU to save this promotion.';
  if (!promotion.mechanicKey) return 'Choose a mechanic.';
  if (!promotion.startMonth || !promotion.endMonth) return 'Choose the months.';
  if (promotion.promoType === SIDE_OFFER_TYPE && (!promotion.startDate || !promotion.endDate)) {
    return 'Choose the dates the side offer runs.';
  }
  return null;
}

/**
 * Request body for saving a promotion: backend ScenarioPromotionBase
 * (app/schemas/scenario/promotions.py). product_name null = all SKUs.
 *
 * @param {object} promotion
 */
export function buildScenarioPromotionPayload(promotion) {
  return {
    customer_name: promotion.customer,
    product_name: promotion.sku || null,
    promo_type: promotion.promoType,
    mechanic_key: promotion.mechanicKey,
    mechanic_label: promotion.mechanicLabel,
    reference_uplift_pct: Number(promotion.referenceUpliftPct) || 0,
    reference_source: promotion.referenceSource || 'placeholder',
    reference_by_sku: promotion.referenceBySku ?? {},
    override_uplift_pct: promotion.overrideUpliftPct,
    voucher: promotion.voucher,
    voucher_uplift_pct: Number(promotion.voucherUpliftPct) || 0,
    voucher_by_sku: promotion.voucherBySku ?? {},
    explanation: promotion.explanation.trim() || null,
    start_month: promotion.startMonth,
    end_month: promotion.endMonth,
    start_date: promotion.startDate || null,
    end_date: promotion.endDate || null,
    is_active: promotion.isActive,
  };
}

/**
 * A saved promotion as the page holds it, from one row the backend
 * returns. On the page `sku` holds the product name, as the forecast rows'
 * filters do.
 *
 * @param {object} row
 */
export function scenarioPromotionFromApi(row) {
  const promotion = {
    id: `saved-promo-${row.promotion_id}`,
    promotionId: row.promotion_id,
    customer: row.customer_name,
    sku: row.product_name ?? '',
    promoType: row.promo_type,
    mechanicKey: row.mechanic_key,
    mechanicLabel: row.mechanic_label,
    referenceUpliftPct: Number(row.reference_uplift_pct),
    referenceSource: row.reference_source,
    referenceBySku: row.reference_by_sku ?? {},
    overrideUpliftPct: row.override_uplift_pct == null ? null : Number(row.override_uplift_pct),
    voucher: row.voucher,
    voucherUpliftPct: Number(row.voucher_uplift_pct),
    voucherBySku: row.voucher_by_sku ?? {},
    explanation: row.explanation ?? '',
    startMonth: row.start_month,
    endMonth: row.end_month,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    isActive: row.is_active,
  };
  return { ...promotion, saved: savedFieldsOf(promotion) };
}

/**
 * The page's copy after a save. If the user kept editing while the save
 * was in flight, those edits stay as unsaved changes on top of it (same
 * rule as applySavedBlock).
 *
 * @param {object} current the promotion as it is now
 * @param {object} sent the promotion as it was sent
 * @param {object} savedPromotion scenarioPromotionFromApi of the returned row
 */
export function applySavedPromotion(current, sent, savedPromotion) {
  const editedSince = SAVED_FIELDS.some((field) => !sameValue(current[field], sent[field]));
  if (editedSince) {
    return { ...current, promotionId: savedPromotion.promotionId, saved: savedPromotion.saved };
  }
  return { ...savedPromotion, id: current.id };
}

/**
 * The promotions that count on the Simulated line: the switched-on ones,
 * saved or not.
 *
 * @param {object[]} promotions
 */
export function activeScenarioPromotions(promotions) {
  return promotions.filter((promotion) => promotion.isActive);
}

// ============================================================
// DAYS RUNNING (Promotions Uplift design, Section 6.5: day-weighted)
// ============================================================

/**
 * Days in a 'YYYY-MM-01' month.
 *
 * @param {string} month
 */
export function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/**
 * 'YYYY-MM-01' for a 'YYYY-MM-DD' date.
 *
 * @param {string} date
 */
export function monthOf(date) {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Last day of a 'YYYY-MM-01' month, as 'YYYY-MM-DD'.
 *
 * @param {string} month
 */
export function lastDayOf(month) {
  return `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/**
 * The share of a month the promotion runs: 1 without dates (whole
 * months), else the days its startDate..endDate covers in that month over
 * the days in the month. A side offer on 1-10 Nov adds a third of its
 * uplift to November.
 *
 * @param {object} promotion
 * @param {string} month 'YYYY-MM-01'
 */
export function dayShare(promotion, month) {
  if (!promotion.startDate || !promotion.endDate) return 1;
  const from = promotion.startDate > month ? promotion.startDate : month;
  const last = lastDayOf(month);
  const to = promotion.endDate < last ? promotion.endDate : last;
  if (to < from) return 0;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  return days / daysInMonth(month);
}

// ============================================================
// SETTINGS CHANGED SINCE SAVING
// ============================================================

/**
 * When Promotion uplift settings now give a different value than the one a
 * saved promotion was set up with: { savedPct, currentPct, voucherChanged }.
 * Null when nothing changed, the promotion was never saved, or settings
 * aren't loaded. Saved promotions keep their value on purpose (so a
 * settings change never moves them silently); this lets the user choose.
 *
 * @param {object} promotion
 * @param {object | undefined} resolved the promotion customer's resolved set
 */
export function settingsChange(promotion, resolved) {
  if (!promotion.saved || !resolved) return null;
  const fresh = withReferences(promotion, resolved);
  const mechanicChanged =
    fresh.referenceUpliftPct !== promotion.referenceUpliftPct ||
    JSON.stringify(fresh.referenceBySku ?? {}) !== JSON.stringify(promotion.referenceBySku ?? {});
  const voucherChanged =
    fresh.voucherUpliftPct !== promotion.voucherUpliftPct ||
    JSON.stringify(fresh.voucherBySku ?? {}) !== JSON.stringify(promotion.voucherBySku ?? {});
  if (!mechanicChanged && !voucherChanged) return null;
  return {
    savedPct: promotion.referenceUpliftPct,
    currentPct: fresh.referenceUpliftPct,
    mechanicChanged,
    voucherChanged,
    savedVoucherPct: promotion.voucherUpliftPct,
    currentVoucherPct: fresh.voucherUpliftPct,
  };
}

// ============================================================
// ONE ACTIVE PROMOTION PER SLOT
// ============================================================

function monthsOverlap(a, b) {
  return a.startMonth <= b.endMonth && b.startMonth <= a.endMonth;
}

/**
 * True when two promotions compete for the same slot: same customer, same
 * promotion type, overlapping months, and the same SKU or one of them
 * covering all SKUs. A monthly promotion and a side offer can run together,
 * so different types never clash.
 *
 * @param {object} a
 * @param {object} b
 */
export function promotionsClash(a, b) {
  if (a.id === b.id) return false;
  if (a.customer !== b.customer || a.promoType !== b.promoType) return false;
  if (a.sku && b.sku && a.sku !== b.sku) return false;
  return monthsOverlap(a, b);
}

/**
 * The other switched-on promotions that clash with `promotion`; switching
 * it on switches these off.
 *
 * @param {object} promotion
 * @param {object[]} promotions
 */
export function clashingActivePromotions(promotion, promotions) {
  return promotions.filter((other) => other.isActive && promotionsClash(promotion, other));
}
