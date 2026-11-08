// Which forecast model (tier) the Forecast page shows, and which rows it
// adds up. Pure and alias-free so `npm test` (node --test) can check it;
// wording comes from forecastLineText.js.
//
// GET /api/forecast returns every tier: one row per customer x SKU x month x
// tier (backend forecast_service.get_forecast_view). Rows of different tiers
// are never added together:
//   - one customer picked: the page shows one tier, chosen in the Model
//     dropdown, and sums that tier's rows across the SKUs in scope;
//   - All customers: each customer x SKU x month is the average of its
//     available tiers, and those averages are summed across customers.

import {
  FORECAST_TIER_OPTIONS,
  confidenceBand,
  tierUnavailableText,
} from './forecastLineText.js';

export const DEFAULT_TIER = 'tier0';
// getForecastView({ tier: ALL_TIERS }) keeps every tier's rows.
export const ALL_TIERS = 'all';
export const TIER_VALUES = FORECAST_TIER_OPTIONS.map((option) => option.value);

/** A ?tier= value as a known tier, else the default (Tier 0). */
export function parseTier(value) {
  return TIER_VALUES.includes(value) ? value : DEFAULT_TIER;
}

/** The selected tier's rows only. */
export function rowsForTier(rows, tier) {
  return (rows ?? []).filter((row) => row.tier === tier);
}

/** Every SKU in the fetched rows, sorted. */
export function skusInRows(rows) {
  return [...new Set((rows ?? []).map((row) => row.sku).filter(Boolean))].sort();
}

/**
 * Whether `tier` can be shown for every SKU in scope. Tier 0 always can. A
 * SKU with no entry for the tier counts as having no forecast from it.
 *
 * @param {Record<string, Record<string, { is_available: boolean, unavailable_reason: string | null }>>} availability
 * @param {string[]} skus
 * @param {string} tier
 * @returns {{ available: boolean, reason: string }}
 */
export function tierStatus(availability, skus, tier) {
  if (tier === DEFAULT_TIER) return { available: true, reason: '' };
  const reasons = skus.flatMap((sku) => {
    const entry = availability?.[sku]?.[tier];
    if (!entry) return ['no_forecast'];
    return entry.is_available ? [] : [entry.unavailable_reason ?? null];
  });
  return { available: reasons.length === 0, reason: tierUnavailableText({ reasons, total: skus.length }) };
}

/** Model dropdown options in tier_order: each disabled, with its reason, unless every SKU in scope has it. */
export function modelOptions(availability, skus) {
  return FORECAST_TIER_OPTIONS.map((option) => {
    const status = tierStatus(availability, skus, option.value);
    return status.available
      ? option
      : { ...option, disabled: true, description: status.reason };
  });
}

/** The tier to show: the one asked for while it is available for every SKU, else Tier 0. */
export function resolveTier(requested, availability, skus) {
  const tier = parseTier(requested);
  return tierStatus(availability, skus, tier).available ? tier : DEFAULT_TIER;
}

/** How many SKUs in scope have any Initial on `tier` (availability has_initial). */
export function initialCoverage(availability, skus, tier) {
  const withInitial = skus.filter((sku) => availability?.[sku]?.[tier]?.has_initial).length;
  return { withInitial, total: skus.length };
}

// Line columns averaged across tiers in the All customers view, carton and
// revenue (backend forecast_service.add_forecast_revenue).
const AVERAGED_COLUMNS = [
  'forecast_initial',
  'forecast_previous',
  'forecast_current',
  'current_low_80',
  'current_high_80',
].flatMap((column) => [column, `${column}_revenue`]);

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * One row per customer x SKU x month whose line values are the average of the
 * tiers that have a value there (an unavailable tier's NULLs are left out, not
 * counted as 0). A line no tier has stays null. Per-tier fields (tier,
 * confidence, model) are dropped: the row is no single model.
 */
export function averageAcrossTiers(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = `${row.customer_id}|${row.sku}|${row.month_year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const averaged = {
      customer_id: first.customer_id,
      customer_name: first.customer_name,
      sku: first.sku,
      product_name: first.product_name,
      month_year: first.month_year,
      tier: null,
      promo_mix: first.promo_mix ?? null,
      realised_price: first.realised_price ?? null,
    };
    for (const column of AVERAGED_COLUMNS) {
      averaged[column] = mean(group.map((row) => row[column]).filter((value) => typeof value === 'number'));
    }
    return averaged;
  });
}

/**
 * Everything the page needs to show one model: the resolved tier, the rows to
 * add up, the dropdown options and the Initial coverage.
 *
 * Without a customer the page shows the average of all models
 * (`mode: 'average'`): no tier is picked and the dropdown is disabled.
 *
 * @param {{ rows: object[], availability: object, requestedTier: string, customerName: string }} options
 */
export function forecastModelView({ rows, availability, requestedTier, customerName }) {
  const skus = skusInRows(rows);
  if (!customerName) {
    return {
      mode: 'average',
      tier: null,
      rows: averageAcrossTiers(rows),
      skus,
      options: FORECAST_TIER_OPTIONS.map((option) => ({ ...option, disabled: true })),
      initial: { withInitial: skus.length, total: skus.length },
    };
  }
  const tier = resolveTier(requestedTier, availability, skus);
  return {
    mode: 'tier',
    tier,
    rows: rowsForTier(rows, tier),
    skus,
    options: modelOptions(availability, skus),
    initial: initialCoverage(availability, skus, tier),
  };
}

/**
 * Past accuracy for one SKU on one tier: the same on every month (a backtest
 * of the model on recent months it didn't see), so read from the first row
 * with a Current forecast. null with no Current forecast.
 */
export function pastAccuracy(rows) {
  const first = (rows ?? [])
    .filter((row) => row.forecast_current != null && row.month_year)
    .sort((a, b) => a.month_year.localeCompare(b.month_year))[0];
  if (!first) return null;
  return { band: confidenceBand(first.current_confidence_band), smape: first.current_backtest_smape ?? null };
}

/**
 * One SKU's confidence for a month's tooltip, or null on a month with no
 * Current forecast (actual-only months show no confidence). `low` / `high`
 * are the 80% bounds in the chart's metric, already picked by the caller.
 */
export function confidenceEntry(row, { low = null, high = null } = {}) {
  if (row?.forecast_current == null) return null;
  return {
    sku: row.sku,
    productName: row.product_name ?? row.sku,
    monthBand: confidenceBand(row.month_confidence_band),
    monthRangePct: row.month_range_pct ?? null,
    low,
    high,
    pastBand: confidenceBand(row.current_confidence_band),
    smape: row.current_backtest_smape ?? null,
    typicalPromo: row.tier === 'tier1_advanced' && Boolean(row.xreg_used_typical_promo),
  };
}

// Rows past this in the several-SKU tooltip become "+N more".
export const CONFIDENCE_ROW_LIMIT = 6;
