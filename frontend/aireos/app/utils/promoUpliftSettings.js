// ============================================================
// PROMOTION UPLIFT SETTINGS -- pure helpers, no React
// ============================================================
//
// Display and preview helpers for the Promotion uplift settings page
// (backend app/services/settings/promo_uplifts.py). The rule itself lives in
// the backend (promo_uplift_rules.placeholder_uplift); placeholderUplift
// below copies it only so the anchor form can preview a change before it is
// saved. Keep the two in step.

import { retailerLabel } from '@/app/utils/retailerLabel';

const ANCHOR_STEP_PCT = 5;
const UPLIFT_PER_STEP_PCT = 2;

const ANCHOR_SOURCE_LABELS = {
  recommended: 'Adopted from data',
  manual: 'Typed in',
  // Nothing saved for this range or customer, so it uses the broader one.
  customer: 'Customer anchor',
  default: 'All-customers default',
};

/**
 * (discount - anchor) / 5 x 2 to a whole percent, halves away from zero
 * (backend ROUND_HALF_UP).
 *
 * @param {number} effectiveDiscountPct
 * @param {number} anchorPct
 */
export function placeholderUplift(effectiveDiscountPct, anchorPct) {
  const value = ((effectiveDiscountPct - anchorPct) / ANCHOR_STEP_PCT) * UPLIFT_PER_STEP_PCT;
  return Math.sign(value) * Math.round(Math.abs(value)) || 0;
}

// StatusPill tone per source, anchors and uplifts alike: from data (adopted
// or learned) info, typed in by someone warning (a judgement worth
// noticing), and everything that falls back to a broader value muted.
const SOURCE_TONES = {
  recommended: 'info',
  learned: 'info',
  manual: 'warning',
  estimate: 'warning',
  customer: 'muted',
  default: 'muted',
  placeholder: 'muted',
};

/**
 * The StatusPill tone for an anchor or uplift source.
 *
 * @param {string} source
 */
export function sourceTone(source) {
  return SOURCE_TONES[source] ?? 'muted';
}

/**
 * Where an anchor value comes from, in words.
 *
 * @param {string} source 'manual' | 'suggested' | 'default'
 */
export function anchorSourceLabel(source) {
  return ANCHOR_SOURCE_LABELS[source] ?? source;
}

/**
 * An anchor for display: "Buy 2 Get 1 Free · 33.3%", or "25% off" when the
 * discount was typed in (no mechanic).
 *
 * @param {{ anchor_pct: number, mechanic_label?: string | null }} anchor
 */
export function anchorLabel(anchor) {
  return anchor.mechanic_label ? `${anchor.mechanic_label} · ${anchor.anchor_pct}%` : `${anchor.anchor_pct}% off`;
}

/**
 * What the data recommends as the anchor now: "30% Off · 7 of 10 months"
 * (months with a moment in the window), or why there is none.
 *
 * @param {{ recommended: { mechanic_label: string, months: number } | null, window_months: number }} anchor
 * @param {number} windowMonths how many months the recommendation counts (backend ANCHOR_WINDOW_MONTHS)
 */
export function recommendedAnchorLabel(anchor, windowMonths) {
  if (anchor.recommended) {
    return `${anchor.recommended.mechanic_label} · ${anchor.recommended.months} of ${anchor.window_months} months`;
  }
  return `Too few moments (${anchor.window_months} in ${windowMonths} months)`;
}

/**
 * Who made a change, for display: the migration's starting rows are
 * recorded as 'seed', which means nobody has changed them yet.
 *
 * @param {string | null} changedBy
 */
export function changedByLabel(changedBy) {
  return changedBy === 'seed' ? 'Starting value' : changedBy ?? '';
}

/**
 * Who a setting row applies to: "All customers", "Fairprice", "Fairprice ·
 * range Pants", "Fairprice · SKU A123".
 *
 * @param {object} row a setting row
 */
export function scopeLabel(row) {
  if (row.scope === 'all') return 'All customers';
  const customer = retailerLabel(row.customer_name ?? '');
  if (row.scope === 'range') return `${customer} · range ${row.sku_range}`;
  if (row.scope === 'sku') return `${customer} · SKU ${row.sku} (no longer applies)`;
  return customer;
}

/**
 * Before/after of every placeholder mechanic when an anchor moves, for the
 * anchor form's preview. Rows that do not follow the anchor are left out.
 *
 * @param {object[]} settings all-customers setting rows
 * @param {number} currentAnchor
 * @param {number} nextAnchor
 */
export function anchorPreview(settings, currentAnchor, nextAnchor) {
  return settings
    .filter((row) => row.scope === 'all' && row.follows_anchor)
    .map((row) => ({
      mechanicKey: row.mechanic_key,
      label: row.mechanic_label,
      before: placeholderUplift(row.effective_discount_pct, currentAnchor),
      after: placeholderUplift(row.effective_discount_pct, nextAnchor),
    }));
}

/**
 * The anchor form's typed value as a number, or an error message.
 *
 * @param {string} text
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseAnchorInput(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { value: null, error: 'Enter a discount between 0 and 100.' };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { value: null, error: 'Enter a discount between 0 and 100.' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { value: null, error: 'Use at most 2 decimal places.' };
  return { value, error: null };
}

/**
 * A typed uplift as a number, or an error message (-90 to 300, 2 dp).
 *
 * @param {string} text
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseUpliftInput(text) {
  const trimmed = String(text ?? '').trim().replace('−', '-');
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value) || value < -90 || value > 300) {
    return { value: null, error: 'Enter an uplift between −90 and 300.' };
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return { value: null, error: 'Use at most 2 decimal places.' };
  return { value, error: null };
}

/**
 * The override form's choices for "One SKU range" and "One SKU", from the
 * SKU master (useSkuCatalog), so an override always names a real range or
 * SKU. Ranges are sorted; SKUs read "Ultra Tape L · 13255043".
 *
 * @param {object[]} skus rows of { sku, sku_range, product_name }
 * @returns {{ ranges: string[], skus: { value: string, label: string }[] }}
 */
export function overrideTargetChoices(skus) {
  // Uplifts and anchors follow SKU ranges, so a range is the narrowest
  // target (backend PromoUpliftOverrideCreate has no SKU scope any more).
  return { ranges: [...new Set(skus.map((row) => row.sku_range).filter(Boolean))].sort() };
}

// ============================================================
// MOMENTS AND RECOMMENDED UPLIFT
// see backend app/services/settings/promo_moment_rules.py
// ============================================================

/**
 * Whether a moment or recommendation (both carry mechanic_key,
 * customer_name, sku_range, sku) falls within a setting row: same mechanic,
 * and within the row's customer, range or SKU. Matched by customer name, not
 * id, so the live moments line up with the demo's customers as well.
 *
 * @param {object} row a setting row, or { scope, mechanic_key, customer_name, sku_range, sku }
 * @param {object} item a moment or recommendation from getPromoMoments
 */
function inScope(row, item) {
  if (item.mechanic_key !== row.mechanic_key) return false;
  if (row.scope === 'all') return true;
  if (item.customer_name !== row.customer_name) return false;
  if (row.scope === 'range') return item.sku_range === row.sku_range;
  if (row.scope === 'sku') return item.sku === row.sku;
  return true;
}

/**
 * How many moments a setting row has, in all and by year.
 *
 * @param {object} row a setting row
 * @param {object[]} moments from getPromoMoments
 * @returns {{ total: number, byYear: Array<[string, number]> }} years oldest first
 */
export function momentCounts(row, moments) {
  const byYear = {};
  for (const moment of moments) {
    if (!inScope(row, moment)) continue;
    const year = moment.month.slice(0, 4);
    byYear[year] = (byYear[year] ?? 0) + 1;
  }
  const years = Object.entries(byYear).sort(([a], [b]) => a.localeCompare(b));
  return { total: years.reduce((sum, [, count]) => sum + count, 0), byYear: years };
}

/**
 * "2025: 3, 2026: 6", or "None" with no moments.
 *
 * @param {{ byYear: Array<[string, number]> }} counts from momentCounts
 */
export function formatMomentCounts(counts) {
  if (!counts.byYear.length) return 'None';
  return counts.byYear.map(([year, count]) => `${year}: ${count}`).join(', ');
}

/**
 * A setting row's Recommended Uplift. The backend recommends per customer x
 * SKU x mechanic; a customer, range or all-customers row shows the average
 * of the SKUs it covers, each counted once. The backend recommends nothing
 * from fewer than `recommend_from` moments, so `value` is null and
 * `enoughData` false until at least one covered SKU has that many. `latestMonth` ('YYYY-MM-01')
 * is the newest moment behind the value, so it moves whenever a new moment
 * changes the recommendation.
 *
 * @param {object} row a setting row, or { scope, mechanic_key, customer_name, sku_range, sku }
 * @param {{ moments: object[], recommendations: object[], recommend_from: number }} data from getPromoMoments
 * @returns {{ value: number | null, products: number, latestMonth: string | null, counts: { total: number, byYear: Array<[string, number]> }, enoughData: boolean }}
 */
export function recommendedUplift(row, data) {
  const used = data.recommendations.filter((item) => inScope(row, item) && item.recommended_uplift_pct != null);
  const values = used.map((item) => item.recommended_uplift_pct);
  // ISO months sort as strings.
  const latestMonth = used.flatMap((item) => item.months_used).sort().at(-1) ?? null;
  const counts = momentCounts(row, data.moments);
  const value = values.length ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100 : null;
  return { value, products: values.length, latestMonth, counts, enoughData: value != null };
}

/**
 * A row's Manual Uplift: the value someone typed (an Estimate), else null.
 *
 * @param {object} row a setting row
 */
export function manualUplift(row) {
  return row.source === 'estimate' ? row.uplift_pct : null;
}

/**
 * The Customer column: "All customers" or the customer's name.
 *
 * @param {object} row a setting row
 */
export function customerColumn(row) {
  return row.scope === 'all' ? 'All customers' : retailerLabel(row.customer_name ?? '');
}

/**
 * The SKU column: "All SKUs", "Range Pants", or "Ultra Tape L · 13255043"
 * (the code alone when the SKU is not in the catalog).
 *
 * @param {object} row a setting row
 * @param {Map<string, string>} productNames sku -> product_name
 */
export function skuColumn(row, productNames) {
  if (row.scope === 'range') return `Range ${row.sku_range}`;
  if (row.scope !== 'sku') return 'All SKU ranges';
  // Saved before uplifts followed SKU ranges; kept for its history only.
  const name = productNames.get(row.sku);
  return `${name ? `${name} · ${row.sku}` : row.sku} (SKU, no longer applies)`;
}

// ============================================================
// CUSTOMER / SKU RANGE / MECHANIC FILTER
// ============================================================

// Most specific first, as the backend picks a value (promo_uplifts._SCOPE_ORDER).
const SCOPE_RANK = { range: 1, customer: 2, all: 3 };

// Same as backend promo_uplifts._applies: a SKU-level row (saved before
// uplifts followed SKU ranges) never applies.
function appliesTo(row, customerName, skuRange) {
  if (row.scope === 'all') return true;
  if (row.customer_name !== customerName) return false;
  if (row.scope === 'customer') return true;
  if (row.scope === 'range') return Boolean(skuRange) && row.sku_range === skuRange;
  return false;
}

function resolvedFor(rows, customerName, skuRange) {
  const best = new Map();
  for (const row of rows) {
    if (!appliesTo(row, customerName, skuRange)) continue;
    const current = best.get(row.mechanic_key);
    if (!current || SCOPE_RANK[row.scope] < SCOPE_RANK[current.scope]) best.set(row.mechanic_key, row);
  }

  const view = skuRange
    ? { scope: 'range', customer_name: customerName, sku: null, sku_range: skuRange }
    : { scope: 'customer', customer_name: customerName, sku: null, sku_range: null };
  return rows
    .filter((row) => row.scope === 'all' && best.has(row.mechanic_key))
    .map((row) => {
      const applied = best.get(row.mechanic_key);
      return { ...applied, view: { ...view, mechanic_key: applied.mechanic_key } };
    });
}

/**
 * The table's rows for the Customer / SKU range / Mechanic filter. With no
 * customer or range, every setting row as saved. Otherwise one row per
 * mechanic for each customer filtered to (a range alone means every
 * customer, since uplifts differ by customer): the most specific saved value
 * that applies there, carrying a `view` ({ scope, customer_name, sku,
 * sku_range, mechanic_key }) that the Customer, SKU range, Recommended and
 * Moments columns read instead of the saved row's own scope. Rows come
 * grouped by mechanic, so customers sit side by side. A mechanic keeps only
 * that mechanic's rows (e.g. every 5% Off value at once).
 *
 * @param {object[]} rows setting rows
 * @param {{ customerName: string, skuRange: string, mechanicKey: string, customers: string[] }} filter '' = all
 * @returns {object[]}
 */
export function filteredUpliftRows(rows, { customerName, skuRange, mechanicKey, customers }) {
  const ofMechanic = mechanicKey ? rows.filter((row) => row.mechanic_key === mechanicKey) : rows;
  if (!customerName && !skuRange) return ofMechanic;

  const names = customerName ? [customerName] : customers;
  const resolved = names.flatMap((name) => resolvedFor(ofMechanic, name, skuRange));
  const order = new Map(rows.filter((row) => row.scope === 'all').map((row, index) => [row.mechanic_key, index]));
  // A stable sort keeps the customers in the order given within each mechanic.
  return resolved.sort((a, b) => order.get(a.mechanic_key) - order.get(b.mechanic_key));
}
