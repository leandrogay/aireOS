// Which forecast model (tier) the Forecast page shows, and which rows it
// adds up. Pure and alias-free so `npm test` (node --test) can check it;
// wording comes from forecastLineText.js.
//
// GET /api/forecast returns every tier: one row per customer x SKU x month x
// tier (backend forecast_service.get_forecast_view). Rows of different tiers
// are never added together, averaged or mixed: the page shows the one tier
// chosen in the Model dropdown (Tier 0 by default, for one customer or All
// customers) and sums that tier's rows across the customer x SKUs in scope.

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
export function tierStatus(availability, skus, tier, { monthsOfHistory = null } = {}) {
  if (tier === DEFAULT_TIER) return { available: true, reason: '' };
  const reasons = skus.flatMap((sku) => {
    const entry = availability?.[sku]?.[tier];
    if (!entry) return ['no_forecast'];
    return entry.is_available ? [] : [entry.unavailable_reason ?? null];
  });
  return {
    available: reasons.length === 0,
    reason: tierUnavailableText({ reasons, total: skus.length, monthsOfHistory }),
  };
}

/**
 * Months of sales the model counted for the one SKU in scope on `tier`
 * (months_of_history), for "this product has 8"; the fewest across its
 * customers, since that is the one holding the model back. Null with
 * several SKUs or none known.
 */
export function monthsOfHistory(rows, skus, tier) {
  if (skus.length !== 1) return null;
  const months = (rows ?? [])
    .filter((row) => row.tier === tier && row.sku === skus[0] && row.months_of_history != null)
    .map((row) => row.months_of_history);
  return months.length ? Math.min(...months) : null;
}

/** Model dropdown options in tier_order: each disabled, with its reason, unless every SKU in scope has it. */
export function modelOptions(availability, skus, rows = []) {
  return FORECAST_TIER_OPTIONS.map((option) => {
    const status = tierStatus(availability, skus, option.value, {
      monthsOfHistory: monthsOfHistory(rows, skus, option.value),
    });
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

/**
 * Everything the page needs to show one model: the resolved tier, its rows,
 * and the dropdown options. The same for one customer and All customers:
 * with several customers in scope `availability` already counts a tier as
 * available for a SKU only when every customer has it (backend
 * forecast_service.forecast_availability), so a Tier 1 option is enabled
 * only if every customer x SKU in scope has it.
 *
 * @param {{ rows: object[], availability: object, requestedTier: string }} options
 */
export function forecastModelView({ rows, availability, requestedTier }) {
  const skus = skusInRows(rows);
  const tier = resolveTier(requestedTier, availability, skus);
  return {
    tier,
    rows: rowsForTier(rows, tier),
    skus,
    options: modelOptions(availability, skus, rows),
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
 * Current, Previous or Initial forecast (actual-only months show no
 * confidence). `low` / `high` (Current), `previousLow` / `previousHigh` and
 * `initialLow` / `initialHigh` are the 80% bounds in cartons.
 * `key` is the customer x SKU, so two customers' rows for one SKU (All
 * customers) stay apart; the tooltip names the customer when they differ.
 *
 * Current, Previous and Initial each get this month's band and range (the
 * backend works out Previous's and Initial's with bigquery.month_range;
 * Initial's was set when the yearly plan was made). Past accuracy is
 * the model's backtest for the series, one score for both lines (Previous
 * comes from the same model); `past` passes it in for a month with no
 * Current row to read it from (pastAccuracy).
 */
export function confidenceEntry(
  row,
  {
    low = null,
    high = null,
    previousLow = null,
    previousHigh = null,
    initialLow = null,
    initialHigh = null,
    past = null,
  } = {}
) {
  const hasCurrent = row?.forecast_current != null;
  const hasPrevious = row?.forecast_previous != null;
  const hasInitial = row?.forecast_initial != null;
  if (!hasCurrent && !hasPrevious && !hasInitial) return null;
  return {
    key: `${row.customer_id}|${row.sku}`,
    sku: row.sku,
    productName: row.product_name ?? row.sku,
    customerName: row.customer_name ?? '',
    hasCurrent,
    monthBand: hasCurrent ? confidenceBand(row.month_confidence_band) : null,
    monthRangePct: hasCurrent ? (row.month_range_pct ?? null) : null,
    low,
    high,
    previous: hasPrevious
      ? {
          band: confidenceBand(row.previous_confidence_band),
          rangePct: row.previous_range_pct ?? null,
          low: previousLow,
          high: previousHigh,
        }
      : null,
    initial: hasInitial
      ? {
          band: confidenceBand(row.initial_confidence_band),
          rangePct: row.initial_range_pct ?? null,
          low: initialLow,
          high: initialHigh,
        }
      : null,
    pastBand: hasCurrent ? confidenceBand(row.current_confidence_band) : (past?.band ?? 'unknown'),
    smape: row.current_backtest_smape ?? past?.smape ?? null,
    typicalPromo: hasCurrent && row.tier === 'tier1_advanced' && Boolean(row.xreg_used_typical_promo),
  };
}

// Rows past this in the several-SKU tooltip become "+N more".
export const CONFIDENCE_ROW_LIMIT = 6;
