// ============================================================
// LIVE PROMOTION UPLIFTS -- pure, import-free (tests/scenarioLiveUplifts.test.mjs)
// ============================================================
//
// Scenario-builder promotions take the uplift Promotion Uplift Settings has
// worked out now (backend GET /api/settings/promo-uplifts/calculated,
// promo_uplift_calc.list_calculated), not the value copied in when they were
// saved: a saved promotion follows new moments and anchor changes. Each
// calculated row is one customer x SKU range x mechanic, holding its anchor
// versions from this month on and, inside each, every SKU of the range.
// A month takes the version in effect then (the latest effective_from on or
// before it; months before the first version take the first, which starts
// this month). A product the rows have no usable value for (unavailable, or
// the calc tables couldn't load) falls back to the value saved with the
// promotion (scenarioPromotions.mechanicUpliftPct).

/**
 * The calculated rows by customer and mechanic, for liveUplift.
 *
 * @param {object[] | undefined} calcRows GET /calculated `rows`
 * @returns {Map<string, object[]>} 'customer|mechanic' -> that customer's rows for the mechanic, one per SKU range
 */
export function liveUpliftIndex(calcRows) {
  const index = new Map();
  for (const row of calcRows ?? []) {
    const key = `${row.customer_name}|${row.mechanic_key}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function versionInEffect(versions, month) {
  let chosen = versions[0] ?? null;
  for (const version of versions) {
    if (version.effective_from <= month) chosen = version;
  }
  return chosen;
}

// The month a version stops applying: the next version's start, or never.
function versionEnd(versions, position) {
  return versions[position + 1]?.effective_from ?? null;
}

/**
 * One product's worked-out uplift for a mechanic in a month:
 * { upliftPct, level, value, anchor, effectiveFrom, skuRange }, or null when
 * there is no usable value (no row, or the level is unavailable).
 * `value` is the SKU entry the explanation is built from
 * (promoUpliftCalc.explanationLines).
 *
 * @param {Map<string, object[]>} index from liveUpliftIndex
 * @param {{ customer: string, mechanicKey: string, product: string, month: string }} where
 */
export function liveUplift(index, { customer, mechanicKey, product, month }) {
  for (const row of index.get(`${customer}|${mechanicKey}`) ?? []) {
    const version = versionInEffect(row.versions ?? [], month);
    const value = version?.skus?.find((item) => item.product_name === product);
    if (!value) continue;
    if (value.uplift_pct == null || value.level === 'unavailable') return null;
    return {
      upliftPct: value.uplift_pct,
      level: value.level,
      value,
      anchor: version.anchor,
      effectiveFrom: version.effective_from,
      skuRange: row.sku_range,
    };
  }
  return null;
}

/**
 * Every worked-out value a promotion takes over its months and SKU ranges,
 * one per SKU x anchor version that applies in those months:
 * { product, skuRange, upliftPct, level, value, anchor, effectiveFrom }.
 * Unavailable values are left out (those products use the saved value).
 * Empty when the rows have nothing for the promotion.
 *
 * @param {Map<string, object[]>} index from liveUpliftIndex
 * @param {{ customer: string, mechanicKey: string, skuRanges?: string[], sku?: string, startMonth: string, endMonth: string }} promotion
 */
export function liveUpliftValues(index, promotion) {
  const ranges = promotion.skuRanges ?? [];
  const values = [];
  for (const row of index.get(`${promotion.customer}|${promotion.mechanicKey}`) ?? []) {
    if (ranges.length && !ranges.includes(row.sku_range)) continue;
    const versions = row.versions ?? [];
    versions.forEach((version, position) => {
      const end = versionEnd(versions, position);
      // The first version also covers any earlier month.
      const startsInTime = position === 0 || version.effective_from <= promotion.endMonth;
      const endsInTime = end == null || end > promotion.startMonth;
      if (!startsInTime || !endsInTime) return;
      for (const value of version.skus ?? []) {
        if (promotion.sku && !ranges.length && value.product_name !== promotion.sku) continue;
        if (value.uplift_pct == null || value.level === 'unavailable') continue;
        values.push({
          product: value.product_name,
          skuRange: row.sku_range,
          upliftPct: value.uplift_pct,
          level: value.level,
          value,
          anchor: version.anchor,
          effectiveFrom: version.effective_from,
        });
      }
    });
  }
  return values;
}

// Least direct first loses: the same order as backend promo_uplift_calc.LEVEL_ORDER.
const LEVEL_ORDER = ['anchor', 'measured', 'measured_earlier', 'placeholder', 'unavailable'];

/**
 * The least direct level among some values, so a summary never reads better
 * than its weakest value (same rule as the Settings page's range rows).
 *
 * @param {{ level: string }[]} values
 * @returns {string | null}
 */
export function weakestLevel(values) {
  let weakest = null;
  for (const { level } of values) {
    if (weakest == null || LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(weakest)) weakest = level;
  }
  return weakest;
}

/**
 * The values to save with a promotion as its fallback ("when saved"): the
 * worked-out value of its first month, one for the promotion and one per
 * product that differs from it. Null when nothing is worked out for it.
 *
 * @param {Map<string, object[]>} index from liveUpliftIndex
 * @param {{ customer: string, mechanicKey: string, skuRanges?: string[], sku?: string, startMonth: string, endMonth: string }} promotion
 * @returns {{ referenceUpliftPct: number, referenceSource: string, referenceBySku: Record<string, number> } | null}
 */
export function liveReferences(index, promotion) {
  const firstMonth = liveUpliftValues(index, { ...promotion, endMonth: promotion.startMonth });
  if (!firstMonth.length) return null;

  // The most common value stands for the promotion; the others are by product.
  const counts = new Map();
  for (const item of firstMonth) counts.set(item.upliftPct, (counts.get(item.upliftPct) ?? 0) + 1);
  const [common] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const referenceBySku = {};
  for (const item of firstMonth) {
    if (item.upliftPct !== common) referenceBySku[item.product] = item.upliftPct;
  }
  return { referenceUpliftPct: common, referenceSource: weakestLevel(firstMonth), referenceBySku };
}
