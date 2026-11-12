// ============================================================
// PROMOTION UPLIFT SETTINGS -- pure helpers, no React
// ============================================================
//
// Display and preview helpers for the Promotion uplift settings page
// (backend app/services/settings/promo_uplifts.py). The rule itself lives in
// the backend (promo_uplift_rules.placeholder_uplift); placeholderUplift
// below copies it only so the anchor form can preview a change before it is
// saved. Keep the two in step.

const ANCHOR_STEP_PCT = 5;
const UPLIFT_PER_STEP_PCT = 2;

const ANCHOR_SOURCE_LABELS = {
  recommended: 'Adopted from data',
  // Picked by hand from the mechanics official promotions use (or, saved
  // before that, a typed discount).
  manual: 'Overwritten',
  // promo_recalc: the anchor official future promotions point to.
  projected: 'Projected from official promotions',
  // Nothing saved for this range or customer, so it uses the broader one.
  customer: 'Customer anchor',
  default: 'Fallback',
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
  projected: 'info',
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
 * @param {string} source 'recommended' | 'manual' | 'projected' | 'customer' | 'default'
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
 * A mechanic's typed discount as a number, or an error message (more than 0,
 * up to 100, 2 dp; backend MechanicDiscountUpdate).
 *
 * @param {string} text
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseDiscountInput(text) {
  const { value, error } = parseAnchorInput(text);
  if (error) return { value, error };
  if (value === 0) return { value: null, error: 'Enter a discount above 0.' };
  return { value, error: null };
}

/**
 * The first line of an anchor's run, with its next change as the second:
 * "from Jun 2027: 15% Off · 15%", or null with none (list_anchors
 * `upcoming`).
 *
 * @param {{ upcoming?: Array<{ effective_from: string, anchor_pct: number, mechanic_label?: string | null }> }} anchor
 * @param {(iso: string) => string} monthText 'YYYY-MM-01' -> "Jun 2027"
 */
export function upcomingAnchorText(anchor, monthText) {
  const next = anchor.upcoming?.[0];
  return next ? `from ${monthText(next.effective_from)}: ${anchorLabel(next)}` : null;
}

// ============================================================
// ANCHORS BY MONTH (the Scenario builder's Breakdown tab and hover card)
// ============================================================

/**
 * Every anchor target in a list_anchors answer: each customer's own, then
 * each of its SKU ranges', as { key, customerName, skuRange (null for the
 * customer's own), entry }.
 *
 * @param {{ customers?: object[] } | null} anchors getPromoAnchors
 */
export function anchorTargets(anchors) {
  return (anchors?.customers ?? []).flatMap((customer) => [
    { key: `${customer.customer_id}:`, customerName: customer.customer_name, skuRange: null, entry: customer },
    ...(customer.ranges ?? []).map((range) => ({
      key: `${customer.customer_id}:${range.sku_range}`,
      customerName: customer.customer_name,
      skuRange: range.sku_range,
      entry: range,
    })),
  ]);
}

/**
 * The anchor in effect in a month: the latest of the entry's upcoming
 * changes starting on or before it, else the entry itself (this month's).
 *
 * @param {{ upcoming?: object[] }} entry a list_anchors customer or range entry
 * @param {string} month 'YYYY-MM-01'
 */
export function anchorInMonth(entry, month) {
  let chosen = entry;
  for (const change of entry.upcoming ?? []) {
    if (change.effective_from <= month) chosen = change;
  }
  return chosen;
}

// ============================================================
// MOMENTS
// see backend app/services/settings/promo_moment_rules.py
// ============================================================

/**
 * How many moments a calculated row (customer x SKU range x mechanic) has,
 * in all and by year.
 *
 * @param {{ customer_name: string, sku_range: string, mechanic_key: string }} row
 * @param {object[]} moments from getPromoMoments
 * @returns {{ total: number, byYear: Array<[string, number]> }} years oldest first
 */
export function momentCounts(row, moments) {
  const byYear = {};
  for (const moment of moments) {
    if (
      moment.mechanic_key !== row.mechanic_key
      || moment.customer_name !== row.customer_name
      || moment.sku_range !== row.sku_range
    ) continue;
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
