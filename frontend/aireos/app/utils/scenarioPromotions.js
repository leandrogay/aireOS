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
//     customers,                            // forecast customer_names ([] = every customer), migration 022
//     skuRanges,                            // SKU ranges ([] = All SKU ranges): promotions follow ranges
//     excludedPairs,                        // [{ customer, skuRange }] switched off on their own (migration 023)
//     sku,                                  // one product_name, only on promotions saved before ranges
//                                           // (backend migration 018); new ones keep ''
//     promoType,                            // 'monthly' | 'side_offer' | 'bundle' | 'others'
//     mechanicKey, mechanicLabel,
//     references,                           // per customer: { referenceUpliftPct, referenceSource,
//                                           // referenceBySku, voucherUpliftPct, voucherBySku } -- the
//                                           // values when chosen (migration 025); each customer x SKU
//                                           // takes its own customer's
//     overrideUpliftPct,                    // null unless the user moved the slider; one for every customer
//     voucher,                              // Yes/No
//     explanation,
//     startMonth, endMonth,                 // 'YYYY-MM-01', forecast months only
//     startDate, endDate,                   // side offers only: the exact days it runs ('YYYY-MM-DD'); '' = whole months
//     isActive,                             // switched on = counts on the Simulated line
//     saved,                                // the fields as last saved, null if never saved
//   }
//
// Saved and switched on/off exactly like building blocks (scenarioBlocks.js):
// edits show on the chart at once, `saved` is what Discard goes back to.
//
// The mechanic's uplift is live: each product and month takes the value
// Promotion Uplift Settings has worked out now, for the anchor version in
// effect that month (scenarioLiveUplifts.js, through `liveIndex`, which
// withLiveIndex puts on a copy of each promotion). The reference values are
// what it was worth when saved, kept as the fallback for products the
// calculation has no value for, and shown as "When saved" beside "Now". An
// override ("Edited for this scenario") beats both. The voucher is never
// measured, so it always uses the value saved with the promotion, which can
// be edited for this scenario.
// Uplifts are relative to an ordinary month (the model forecast), so they
// can be negative: a shallower discount than usual sells less.
//
// `resolved` below is one customer's GET /api/settings/promo-uplifts/resolved
// answer ({ anchor, uplifts, product_uplifts, range_uplifts, range_anchors, product_ranges }),
// from usePromoUplifts. A range promotion takes its range's values.

import { PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { levelLabel } from '@/app/utils/promoUpliftCalc';
import { customersLabel } from '@/app/utils/retailerLabel';
import { PART_COLORS } from '@/app/utils/scenarioComposition';
import { coversCustomer, itemRows, pairExcluded } from '@/app/utils/scenarioEngine';
import { promotionCells } from '@/app/utils/scenarioTier0Split';
import { liveReferences, liveUplift, liveUpliftValues, weakestLevel } from '@/app/utils/scenarioLiveUplifts';
import { resolvedUpliftDetails, snapshotUpliftDetails } from './promotionUpliftDetails.js';

export const MIN_OVERRIDE_PCT = -20;
export const MAX_OVERRIDE_PCT = 50;
// Only a tie-breaker now: the default is the mechanic nearest 0%, see
// defaultMechanic().
export const DEFAULT_MECHANIC_KEY = 'pct_off_20';
export const VOUCHER_KEY = 'voucher';

// Side offers run weekly, so they are planned on exact dates (dayShare).
export const SIDE_OFFER_TYPE = 'side_offer';

// The pipeline's ARIMA_PLUS_XREG model already reflects the promotion
// entered for the months it forecasts. The Scenario builder reads Tier 0
// only, so no row there is from that model; the check stays in case it ever
// shows another tier.
export const MODEL_INCLUDES_PROMOS = 'tier1_arimax';

// Sources saved before the uplifts were worked out (Phase 3) that are not
// a level of promoUpliftCalc.
const OLD_SOURCE_LABELS = {
  estimate: 'Estimate',
  learned: 'Learned by model',
};

/**
 * Display label for the level or source an uplift was saved with.
 *
 * @param {string} source
 */
export function sourceLabel(source) {
  if (!source) return '';
  return OLD_SOURCE_LABELS[source] ?? levelLabel(source);
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
 * Values a mechanic takes across a promotion's SKU ranges, for showing "+3%
 * to +6% by SKU range": each picked range's value (every SKU of a range
 * shares it), or, for All SKU ranges, the customer's value plus every
 * product's own value.
 *
 * @param {object | undefined} resolved
 * @param {object} row a mechanic row from resolved.uplifts
 * @param {string[]} [skuRanges] [] = All SKU ranges
 */
export function valuesAcrossSkus(resolved, row, skuRanges = []) {
  if (skuRanges.length) {
    return skuRanges.map((range) => resolved?.range_uplifts?.[range]?.[row.mechanic_key] ?? row.uplift_pct);
  }
  const own = Object.values(resolved?.product_uplifts ?? {})
    .map((values) => values[row.mechanic_key])
    .filter((value) => value != null);
  return [row.uplift_pct, ...own];
}

function valueFor(resolved, key, skuRanges, sku) {
  const base = (resolved?.uplifts ?? []).find((row) => row.mechanic_key === key);
  if (!base) return { value: null, source: '', bySku: {} };

  // One range: every SKU of it takes the range's value (backend resolve_uplifts range_uplifts).
  if (skuRanges.length === 1) {
    return { value: resolved?.range_uplifts?.[skuRanges[0]]?.[key] ?? base.uplift_pct, source: base.source, bySku: {} };
  }
  const products = resolved?.product_uplifts ?? {};
  // One SKU: only on a promotion saved before ranges.
  if (sku && !skuRanges.length) {
    return { value: products[sku]?.[key] ?? base.uplift_pct, source: base.source, bySku: {} };
  }

  // Several ranges or all of them: the customer's value, plus each product's
  // own value for the products in those ranges (all products when none picked).
  const productRanges = resolved?.product_ranges ?? {};
  const bySku = {};
  for (const [product, values] of Object.entries(products)) {
    if (values[key] == null) continue;
    if (skuRanges.length && !skuRanges.includes(productRanges[product])) continue;
    bySku[product] = values[key];
  }
  return { value: base.uplift_pct, source: base.source, bySku };
}

const NO_REFERENCES = { referenceUpliftPct: 0, referenceSource: '', referenceBySku: {}, voucherUpliftPct: 0, voucherBySku: {} };

/**
 * The customers a promotion's values are kept for: the ones it names, or,
 * covering every customer, each one it has values for.
 *
 * @param {{ customers?: string[], references?: Record<string, object> }} promotion
 */
export function promotionCustomers(promotion) {
  return promotion.customers?.length ? promotion.customers : Object.keys(promotion.references ?? {}).sort();
}

/**
 * One customer's values kept on a promotion (zeros when it has none).
 *
 * @param {object} promotion
 * @param {string} customer
 */
export function referencesFor(promotion, customer) {
  return promotion.references?.[customer] ?? NO_REFERENCES;
}

// Every customer's kept values, in promotionCustomers order.
function allReferences(promotion) {
  const customers = promotionCustomers(promotion);
  return customers.length ? customers.map((customer) => referencesFor(promotion, customer)) : [NO_REFERENCES];
}

/**
 * Copy the current setting values for each of a promotion's customers, its
 * SKU ranges and mechanic onto it. Keeps any override; called whenever one
 * of those changes (not on every render).
 *
 * @param {object} promotion
 * @param {Record<string, object>} upliftsByCustomer each customer's resolved set (usePromoUplifts)
 * @param {Map<string, object[]> | null} [liveIndex]
 */
export function withReferences(promotion, upliftsByCustomer, liveIndex) {
  const customers = promotion.customers?.length ? promotion.customers : Object.keys(upliftsByCustomer ?? {}).sort();
  if (!customers.some((customer) => upliftsByCustomer?.[customer])) return promotion;
  let mechanicLabel = promotion.mechanicLabel;
  const references = {};
  for (const customer of customers) {
    const resolved = upliftsByCustomer?.[customer];
    const before = referencesFor(promotion, customer);
    if (!resolved) {
      references[customer] = before;
      continue;
    }
    const mechanic = valueFor(resolved, promotion.mechanicKey, promotion.skuRanges ?? [], promotion.sku);
    const voucher = valueFor(resolved, VOUCHER_KEY, promotion.skuRanges ?? [], promotion.sku);
    const row = mechanicOptions(resolved).find((option) => option.mechanic_key === promotion.mechanicKey);
    if (row) mechanicLabel = row.mechanic_label;
    // The worked-out value when there is one; the resolved setting otherwise.
    const live = liveIndex ? liveReferences(liveIndex, { ...promotion, customer }) : null;
    references[customer] = {
      referenceUpliftPct: live?.referenceUpliftPct ?? mechanic.value ?? before.referenceUpliftPct,
      referenceSource: live?.referenceSource ?? (mechanic.source || before.referenceSource),
      referenceBySku: live?.referenceBySku ?? mechanic.bySku,
      voucherUpliftPct: voucher.value ?? before.voucherUpliftPct,
      voucherBySku: voucher.bySku,
    };
    references[customer].referenceDetails = live
      ? snapshotUpliftDetails(liveUpliftValues(liveIndex, { ...promotion, customer, endMonth: promotion.startMonth }))
      : resolvedUpliftDetails(resolved, promotion, references[customer]);
  }
  return { ...promotion, mechanicLabel, references };
}

/**
 * Each customer's voucher value from Promotion uplift settings for this
 * promotion's SKU ranges: what "Reset" goes back to after the voucher was
 * edited for this scenario. Null when no customer has one.
 *
 * @param {object} promotion
 * @param {Record<string, object>} upliftsByCustomer
 * @returns {Record<string, { voucherUpliftPct: number, voucherBySku: Record<string, number> }> | null}
 */
export function voucherReferences(promotion, upliftsByCustomer) {
  const settings = {};
  for (const customer of promotionCustomers(promotion)) {
    const voucher = valueFor(upliftsByCustomer?.[customer], VOUCHER_KEY, promotion.skuRanges ?? [], promotion.sku);
    if (voucher.value != null) settings[customer] = { voucherUpliftPct: voucher.value, voucherBySku: voucher.bySku };
  }
  return Object.keys(settings).length ? settings : null;
}

/**
 * True when the voucher was edited for this scenario (some customer's
 * value differs from its setting's).
 *
 * @param {object} promotion
 * @param {Record<string, object>} upliftsByCustomer
 */
export function voucherEdited(promotion, upliftsByCustomer) {
  const settings = voucherReferences(promotion, upliftsByCustomer);
  if (!settings) return false;
  return Object.entries(settings).some(([customer, setting]) => {
    const kept = referencesFor(promotion, customer);
    return setting.voucherUpliftPct !== kept.voucherUpliftPct || !sameValue(setting.voucherBySku, kept.voucherBySku ?? {});
  });
}

/**
 * The change that sets the voucher: one value for every customer (an edit
 * for this scenario), or, given `settings`, each customer's own again.
 *
 * @param {object} promotion
 * @param {{ pct?: number, settings?: Record<string, { voucherUpliftPct: number, voucherBySku: object }> }} voucher
 * @returns {{ references: Record<string, object> }}
 */
export function voucherChange(promotion, { pct, settings }) {
  const references = {};
  for (const customer of promotionCustomers(promotion)) {
    const kept = referencesFor(promotion, customer);
    const value = settings ? settings[customer] ?? { voucherUpliftPct: kept.voucherUpliftPct, voucherBySku: kept.voucherBySku } : { voucherUpliftPct: pct, voucherBySku: {} };
    references[customer] = { ...kept, ...value };
  }
  return { references };
}

/**
 * The promotion with each customer's "when saved" values set to what is
 * worked out now, so a save records them (the fallback, and the note's
 * "When saved"). Vouchers are left as they are. Unchanged when nothing is
 * worked out for it.
 *
 * @param {object} promotion
 * @param {Map<string, object[]> | null} liveIndex
 */
export function withLiveReferences(promotion, liveIndex) {
  if (!liveIndex) return promotion;
  let changed = false;
  const references = { ...promotion.references };
  for (const customer of promotionCustomers(promotion)) {
    const live = liveReferences(liveIndex, { ...promotion, customer });
    if (!live) continue;
    references[customer] = { ...referencesFor(promotion, customer), ...live,
      referenceDetails: snapshotUpliftDetails(liveUpliftValues(liveIndex, { ...promotion, customer, endMonth: promotion.startMonth })),
    };
    changed = true;
  }
  return changed ? { ...promotion, references } : promotion;
}

// The worked-out values a promotion takes, over every customer it covers.
function liveValuesAcross(index, promotion) {
  return promotionCustomers(promotion).flatMap((customer) => liveUpliftValues(index, { ...promotion, customer }));
}

/**
 * Copies of the promotions carrying the live uplifts, for the engine
 * (scenarioPromotionsSource.deltas) and describe(). Never stored on the page's
 * promotions, so saving and unsaved-change checks never see it.
 *
 * @param {object[]} promotions
 * @param {Map<string, object[]> | null} liveIndex
 */
export function withLiveIndex(promotions, liveIndex) {
  return liveIndex ? promotions.map((promotion) => ({ ...promotion, liveIndex })) : promotions;
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
 * @param {{ customers?: string[], skuRanges?: string[], months: string[], upliftsByCustomer: Record<string, object> }} defaults
 */
export function newDraftPromotion({ customers = [], skuRanges = [], months = [], upliftsByCustomer = {} }) {
  // Mechanics are the same for every customer; the first one's set picks the default.
  const lead = customers[0] ?? Object.keys(upliftsByCustomer).sort()[0];
  const mechanic = defaultMechanic(upliftsByCustomer[lead]);
  const promotion = {
    id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customers,
    skuRanges,
    excludedPairs: [],
    sku: '',
    promoType: PROMO_OVERLAY_TYPES[0].value,
    mechanicKey: mechanic?.mechanic_key ?? '',
    mechanicLabel: mechanic?.mechanic_label ?? '',
    references: {},
    overrideUpliftPct: null,
    voucher: false,
    explanation: '',
    startMonth: months[0] ?? '',
    endMonth: months[0] ?? '',
    startDate: '',
    endDate: '',
    promotionId: null,
    isActive: true,
    saved: null,
  };
  return withReferences(promotion, upliftsByCustomer);
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
 * The mechanic part of the uplift for one customer's product in one month:
 * the override if set (one for every customer), else that customer's value
 * worked out now for that month (when the promotion carries `liveIndex`),
 * else that customer's value for the product when saved.
 *
 * @param {object} promotion
 * @param {string} customer
 * @param {string} [product] a product_name
 * @param {string} [month] 'YYYY-MM-01'
 */
export function mechanicUpliftPct(promotion, customer, product, month) {
  if (promotion.overrideUpliftPct != null) return promotion.overrideUpliftPct;
  if (promotion.liveIndex && product && month) {
    const live = liveUplift(promotion.liveIndex, { customer, mechanicKey: promotion.mechanicKey, product, month });
    if (live) return live.upliftPct;
  }
  const kept = referencesFor(promotion, customer);
  return kept.referenceBySku?.[product] ?? kept.referenceUpliftPct ?? 0;
}

/**
 * The voucher part for one customer's product: the value saved with the
 * promotion (vouchers are never measured), when the voucher is Yes.
 *
 * @param {object} promotion
 * @param {string} customer
 * @param {string} [product]
 */
export function voucherUpliftPct(promotion, customer, product) {
  if (!promotion.voucher) return 0;
  const kept = referencesFor(promotion, customer);
  return kept.voucherBySku?.[product] ?? kept.voucherUpliftPct ?? 0;
}

/**
 * Effective uplift = mechanic uplift + voucher uplift when the voucher is
 * Yes (design Section 6.2), for one customer's product in one month.
 *
 * @param {object} promotion
 * @param {string} customer
 * @param {string} [product]
 * @param {string} [month]
 */
export function effectiveUpliftPct(promotion, customer, product, month) {
  return mechanicUpliftPct(promotion, customer, product, month) + voucherUpliftPct(promotion, customer, product);
}

/**
 * The mechanic values a promotion takes now, over its products and months:
 * the override alone, else the live values (the saved ones when nothing is
 * worked out for it).
 *
 * @param {object} promotion
 * @param {Map<string, object[]> | null} [liveIndex] defaults to the promotion's own
 * @returns {number[]}
 */
export function mechanicUpliftRange(promotion, liveIndex = promotion.liveIndex) {
  if (promotion.overrideUpliftPct != null) return [promotion.overrideUpliftPct];
  const live = liveIndex ? liveValuesAcross(liveIndex, promotion) : [];
  if (live.length) return live.map((item) => item.upliftPct);
  return allReferences(promotion).flatMap((kept) => [kept.referenceUpliftPct ?? 0, ...Object.values(kept.referenceBySku ?? {})]);
}

/**
 * Every effective uplift a promotion can take (mechanic + voucher).
 *
 * @param {object} promotion
 * @param {Map<string, object[]> | null} [liveIndex]
 */
export function effectiveUpliftRange(promotion, liveIndex = promotion.liveIndex) {
  const vouchers = promotion.voucher
    ? allReferences(promotion).flatMap((kept) => [kept.voucherUpliftPct ?? 0, ...Object.values(kept.voucherBySku ?? {})])
    : [0];
  const mechanics = mechanicUpliftRange(promotion, liveIndex);
  return mechanics.flatMap((mechanic) => vouchers.map((voucher) => mechanic + voucher));
}

/**
 * Where the mechanic's uplift comes from now: 'override', 'live' (worked
 * out, with the weakest level among its values) or 'saved' (nothing worked
 * out for it, or the calculation couldn't load).
 *
 * @param {object} promotion
 * @param {Map<string, object[]> | null} liveIndex
 * @returns {{ kind: 'override' | 'live' | 'saved', level: string | null, values: object[] }}
 */
export function upliftBasis(promotion, liveIndex) {
  if (promotion.overrideUpliftPct != null) return { kind: 'override', level: null, values: [] };
  const values = liveIndex ? liveValuesAcross(liveIndex, promotion) : [];
  if (values.length) return { kind: 'live', level: weakestLevel(values), values };
  const sources = allReferences(promotion).map((kept) => kept.referenceSource).filter(Boolean);
  return { kind: 'saved', level: sources.length ? weakestLevel(sources.map((level) => ({ level }))) : null, values: [] };
}

/**
 * For a saved promotion whose worked-out value has moved since it was
 * saved: { saved: number[], savedLevel, now: number[], nowLevel }. Null when
 * it was never saved, is overridden, nothing is worked out for it, or the
 * values match. Nothing to apply: the live value already counts.
 *
 * @param {object} promotion
 * @param {Map<string, object[]> | null} liveIndex
 */
export function upliftChangedSinceSaved(promotion, liveIndex) {
  if (!promotion.saved || promotion.overrideUpliftPct != null || !liveIndex) return null;
  const values = liveValuesAcross(liveIndex, promotion);
  if (!values.length) return null;
  const savedReferences = allReferences({ ...promotion, ...promotion.saved });
  const saved = savedReferences.flatMap((kept) => [kept.referenceUpliftPct ?? 0, ...Object.values(kept.referenceBySku ?? {})]);
  const now = values.map((item) => item.upliftPct);
  const sameValues = Math.min(...saved) === Math.min(...now) && Math.max(...saved) === Math.max(...now);
  if (sameValues) return null;
  const savedSources = savedReferences.map((kept) => kept.referenceSource).filter(Boolean);
  const savedLevel = savedSources.length ? weakestLevel(savedSources.map((level) => ({ level }))) : null;
  return { saved, savedLevel, now, nowLevel: weakestLevel(values) };
}

function inPromotion(row, promotion) {
  if (row.forecast_current == null) return false;
  if (!coversCustomer(promotion, row.customer_name)) return false;
  if (pairExcluded(promotion, row.customer_name, row.sku_range ?? null)) return false;
  if (promotion.skuRanges?.length && !promotion.skuRanges.includes(row.sku_range)) return false;
  if (promotion.sku && row.product_name !== promotion.sku) return false;
  return row.month_year >= promotion.startMonth && row.month_year <= promotion.endMonth;
}

/**
 * The SKU-months inside the promotion whose Current forecast already
 * includes the promotion entered for them (ARIMA_PLUS_XREG): the planned
 * promotion's uplift is added on top of that one there. On Tier 0, which the
 * Scenario builder reads, this comes back empty.
 *
 * @param {object} promotion
 * @param {object[]} rows the forecast rows of the current view
 * @returns {{ count: number, months: string[] }}
 */
export function stackedModelCells(promotion, rows) {
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

/**
 * What a promotion covers, for lists: its SKU range, its one SKU (saved
 * before ranges), or "All SKUs".
 *
 * @param {{ skuRanges?: string[], sku?: string }} promotion
 */
export function promotionScopeLabel(promotion) {
  if (promotion.skuRanges?.length) return promotion.skuRanges.join(', ');
  return promotion.sku || 'All SKU ranges';
}

function describeTitle(promotion) {
  const label = promotion.mechanicLabel || 'Draft promotion';
  const overridden = promotion.overrideUpliftPct != null;
  if (promotion.voucher) {
    const mechanicPart = overridden
      ? `edited to ${formatPct(promotion.overrideUpliftPct)}`
      : formatPctRange(mechanicUpliftRange(promotion));
    const vouchers = allReferences(promotion).map((kept) => kept.voucherUpliftPct ?? 0);
    return `${label} + voucher (${mechanicPart}, voucher ${formatPctRange(vouchers)})`;
  }
  if (overridden) return `${label} (edited to ${formatPct(promotion.overrideUpliftPct)})`;
  return label;
}

export const scenarioPromotionsSource = {
  key: 'promotions',
  itemsKey: 'promotions',
  label: 'Promotion',
  // Rows are taken one product and month at a time, so each product takes
  // its own value for the anchor version in effect that month.
  // A promotion running part of a month counts for that share of it
  // (dayShare), the same day-weighting the anchor uses. Worked out on Tier
  // 0's baseline, replacing what Tier 0 carries where nothing official is
  // planned (scenarioTier0Split.promotionCells).
  deltas(promotions, rows, view) {
    return promotionCells(
      promotions,
      view?.tier0Split ?? null,
      (promotion) => itemRows(rows, promotion),
      (promotion, row) =>
        effectiveUpliftPct(promotion, row.customer_name, row.product_name, row.month_year) *
        dayShare(promotion, row.month_year),
      (promotion, month) => dayShare(promotion, month)
    );
  },
  describe(promotion) {
    return {
      title: describeTitle(promotion),
      upliftLabel: formatPctRange(effectiveUpliftRange(promotion)),
      customer: customersLabel(promotion.customers),
      sku: promotionScopeLabel(promotion),
      explanation: promotion.explanation,
      startMonth: promotion.startMonth,
      endMonth: promotion.endMonth,
    };
  },
};

/**
 * Outlined bands for draft promotions on the chart, one per promotion:
 * { key, startMonth, endMonth, color }, in the scenario promotions' part
 * colour (not the promotion type's) so they match the Breakdown tab.
 * ForecastChart draws them through its `scenario.promoBands` prop.
 *
 * @param {object[]} promotions the draft's promotions
 */
export function draftPromotionBands(promotions) {
  return promotions
    .filter((promotion) => promotion.startMonth && promotion.endMonth)
    .map((promotion) => ({
      key: promotion.id,
      startMonth: promotion.startMonth,
      endMonth: promotion.endMonth,
      color: PART_COLORS.promotions,
    }));
}

// ============================================================
// SAVING (backend /api/scenario/promotions, scenarioPromotionsApi.js)
// ============================================================

// The fields a save writes; `saved` keeps a copy of exactly these.
const SAVED_FIELDS = [
  'customers',
  'skuRanges',
  'excludedPairs',
  'sku',
  'promoType',
  'mechanicKey',
  'mechanicLabel',
  'references',
  'overrideUpliftPct',
  'voucher',
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
  if (!promotion.mechanicKey) return 'Choose a mechanic.';
  if (!promotion.startMonth || !promotion.endMonth) return 'Choose the months.';
  if (promotion.promoType === SIDE_OFFER_TYPE && (!promotion.startDate || !promotion.endDate)) {
    return 'Choose the dates the side offer runs.';
  }
  return null;
}

/**
 * Request body for saving a promotion: backend ScenarioPromotionBase
 * (app/schemas/scenario/promotions.py): customer_names (null = every
 * customer), sku_ranges (null = All SKU ranges), or product_name, which is
 * only set on a promotion saved before ranges. Each customer's values go in
 * references_by_customer; the single reference_* fields carry the first
 * customer's, for code that reads one.
 *
 * @param {object} promotion
 */
export function buildScenarioPromotionPayload(promotion) {
  const customers = promotionCustomers(promotion);
  const lead = referencesFor(promotion, customers[0]);
  const referencePayload = (kept) => ({
    reference_uplift_pct: Number(kept.referenceUpliftPct) || 0,
    reference_source: kept.referenceSource || 'placeholder',
    reference_by_sku: kept.referenceBySku ?? {},
    voucher_uplift_pct: Number(kept.voucherUpliftPct) || 0,
    voucher_by_sku: kept.voucherBySku ?? {},
  });
  return {
    customer_names: promotion.customers?.length ? promotion.customers : null,
    sku_ranges: promotion.skuRanges?.length ? promotion.skuRanges : null,
    excluded_pairs: (promotion.excludedPairs ?? []).map((pair) => ({ customer_name: pair.customer, sku_range: pair.skuRange ?? null })),
    product_name: promotion.skuRanges?.length ? null : promotion.sku || null,
    promo_type: promotion.promoType,
    mechanic_key: promotion.mechanicKey,
    mechanic_label: promotion.mechanicLabel,
    ...referencePayload(lead),
    references_by_customer: Object.fromEntries(customers.map((customer) => [customer, {
      ...referencePayload(referencesFor(promotion, customer)),
      reference_details: referencesFor(promotion, customer).referenceDetails ?? [],
    }])),
    override_uplift_pct: promotion.overrideUpliftPct,
    voucher: promotion.voucher,
    explanation: promotion.explanation.trim() || null,
    start_month: promotion.startMonth,
    end_month: promotion.endMonth,
    start_date: promotion.startDate || null,
    end_date: promotion.endDate || null,
    is_active: promotion.isActive,
  };
}

// Each customer's kept values; a promotion saved before migration 025 has
// only the single reference_* fields, which were its one customer's.
function referencesFromApi(row) {
  const fromRow = (values) => ({
    referenceUpliftPct: Number(values.reference_uplift_pct),
    referenceSource: values.reference_source,
    referenceBySku: values.reference_by_sku ?? {},
    voucherUpliftPct: Number(values.voucher_uplift_pct),
    voucherBySku: values.voucher_by_sku ?? {},
    referenceDetails: values.reference_details ?? [],
  });
  const byCustomer = row.references_by_customer ?? {};
  if (Object.keys(byCustomer).length) {
    return Object.fromEntries(Object.entries(byCustomer).map(([customer, values]) => [customer, fromRow(values)]));
  }
  return Object.fromEntries((row.customer_names ?? []).map((customer) => [customer, fromRow(row)]));
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
    customers: row.customer_names ?? [],
    skuRanges: row.sku_ranges ?? [],
    excludedPairs: (row.excluded_pairs ?? []).map((pair) => ({ customer: pair.customer_name, skuRange: pair.sku_range ?? null })),
    sku: row.product_name ?? '',
    promoType: row.promo_type,
    mechanicKey: row.mechanic_key,
    mechanicLabel: row.mechanic_label,
    references: referencesFromApi(row),
    overrideUpliftPct: row.override_uplift_pct == null ? null : Number(row.override_uplift_pct),
    voucher: row.voucher,
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
// ONE ACTIVE PROMOTION PER SLOT
// ============================================================

function monthsOverlap(a, b) {
  return a.startMonth <= b.endMonth && b.startMonth <= a.endMonth;
}

/**
 * True when two promotions compete for the same slot: a customer in common
 * (every customer shares each one), same promotion type, overlapping months,
 * and the same SKU or one of them covering all SKUs. A monthly promotion and a side offer can run together,
 * so different types never clash.
 *
 * @param {object} a
 * @param {object} b
 */
export function promotionsClash(a, b) {
  if (a.id === b.id) return false;
  if (a.promoType !== b.promoType) return false;
  const shareCustomer =
    !a.customers?.length || !b.customers?.length || a.customers.some((customer) => b.customers.includes(customer));
  if (!shareCustomer) return false;
  // Ranges clash only when they share one ([] = all ranges shares every one).
  if (a.skuRanges?.length && b.skuRanges?.length && !a.skuRanges.some((range) => b.skuRanges.includes(range))) {
    return false;
  }
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
