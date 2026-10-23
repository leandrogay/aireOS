// ============================================================
// PROMOTION UPLIFT SETTINGS -- pure helpers, no React
// ============================================================
//
// Display and preview helpers for the Promotion Uplift Settings page
// (backend app/services/settings/promo_uplifts.py). The rule itself lives in
// the backend (promo_uplift_rules.placeholder_uplift); placeholderUplift
// below copies it only so the anchor form can preview a change before it is
// saved. Keep the two in step.

import { retailerLabel } from '@/app/utils/retailerLabel';

const ANCHOR_STEP_PCT = 5;
const UPLIFT_PER_STEP_PCT = 2;

const ANCHOR_SOURCE_LABELS = {
  manual: 'Set by hand',
  suggested: 'Suggested from data',
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

/**
 * Where an anchor value comes from, in words.
 *
 * @param {string} source 'manual' | 'suggested' | 'default'
 */
export function anchorSourceLabel(source) {
  return ANCHOR_SOURCE_LABELS[source] ?? source;
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
  if (row.scope === 'sku') return `${customer} · SKU ${row.sku}`;
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
