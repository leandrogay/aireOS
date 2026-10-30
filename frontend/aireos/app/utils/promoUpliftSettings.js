// ============================================================
// PROMOTION UPLIFT SETTINGS -- pure helpers, no React
// ============================================================
//
// Display and preview helpers for the Promotion uplift settings page
// (backend app/services/settings/promo_uplifts.py). The rule itself lives in
// the backend (promo_uplift_rules.rule_based_uplift); ruleBasedUplift below
// copies it only so the anchor and rule dialogs can preview a change before
// it is saved. Keep the two in step.

import { retailerLabel } from '@/app/utils/retailerLabel';

// The rule's default rate: +0.4% sales per extra point of discount deeper
// than the customer's normal discount (backend DEFAULT_UPLIFT_PER_POINT_PCT).
export const DEFAULT_UPLIFT_PER_POINT_PCT = 0.4;

// Above this rate the rule dialog warns (saving still works).
export const RULE_WARNING_ABOVE_PCT = 1;
export const RULE_WARNING = 'This is much higher than the default 0.4% per point. Check the preview before saving.';

// Every rule-based uplift is kept within the range the settings table allows.
const MIN_UPLIFT_PCT = -90;
const MAX_UPLIFT_PCT = 300;

const ANCHOR_SOURCE_LABELS = {
  manual: 'Set by hand',
  suggested: 'Suggested from data',
  default: 'All-customers default',
};

function uncappedRuleBasedUplift(effectiveDiscountPct, anchorPct, rate) {
  // Whole hundredths first, so 0.1 + 0.2 style float errors can't tip a half.
  const value = Math.round((effectiveDiscountPct - anchorPct) * rate * 100) / 100;
  return Math.sign(value) * Math.round(Math.abs(value)) || 0;
}

/**
 * Rule-based uplift: (discount - anchor) x rate, to a whole percent, halves
 * away from zero (backend ROUND_HALF_UP), kept within -90..+300.
 *
 * @param {number} effectiveDiscountPct
 * @param {number} anchorPct
 * @param {number} [rate] % per point; the default 0.4
 */
export function ruleBasedUplift(effectiveDiscountPct, anchorPct, rate = DEFAULT_UPLIFT_PER_POINT_PCT) {
  const value = uncappedRuleBasedUplift(effectiveDiscountPct, anchorPct, rate);
  return Math.min(Math.max(value, MIN_UPLIFT_PCT), MAX_UPLIFT_PCT);
}

/**
 * True when the rule's answer had to be kept within -90..+300.
 *
 * @param {number} effectiveDiscountPct
 * @param {number} anchorPct
 * @param {number} [rate]
 */
export function ruleBasedUpliftCapped(effectiveDiscountPct, anchorPct, rate = DEFAULT_UPLIFT_PER_POINT_PCT) {
  const value = uncappedRuleBasedUplift(effectiveDiscountPct, anchorPct, rate);
  return value < MIN_UPLIFT_PCT || value > MAX_UPLIFT_PCT;
}

/**
 * The short note shown where a rule-based uplift was capped, e.g. "capped at +300%".
 *
 * @param {number} upliftPct the capped uplift
 */
export function cappedNote(upliftPct) {
  return upliftPct >= MAX_UPLIFT_PCT ? `capped at +${MAX_UPLIFT_PCT}%` : `capped at −${Math.abs(MIN_UPLIFT_PCT)}%`;
}

/**
 * The uplift shown for a setting row: rule-based uplifts follow the rule and
 * the anchor, so they are worked out again at the ones being shown.
 *
 * @param {object} row a setting row
 * @param {number} anchorPct
 * @param {number} [rate]
 */
export function shownUplift(row, anchorPct, rate = DEFAULT_UPLIFT_PER_POINT_PCT) {
  return row.follows_rule ? ruleBasedUplift(row.effective_discount_pct, anchorPct, rate) : row.uplift_pct;
}

/**
 * Whether the shown uplift of a rule-based row was capped.
 *
 * @param {object} row
 * @param {number} anchorPct
 * @param {number} [rate]
 */
export function shownUpliftCapped(row, anchorPct, rate = DEFAULT_UPLIFT_PER_POINT_PCT) {
  return Boolean(row.follows_rule) && ruleBasedUpliftCapped(row.effective_discount_pct, anchorPct, rate);
}

/**
 * The rule card's read-only example: what 5 points deeper than normal gives,
 * to one decimal place with a trailing ".0" dropped ("+2%", "+2.3%").
 *
 * @param {number} rate % per point
 */
export function ruleExample(rate) {
  const value = Math.round(5 * rate * 10) / 10;
  return `+${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * The rate typed in the rule dialog as a number, or an error message: more
 * than 0, at most 2 decimals. No upper limit (a high rate only warns).
 *
 * @param {string} text
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseRateInput(text) {
  const trimmed = String(text ?? '').trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value) || value <= 0) {
    return { value: null, error: 'Enter a rate of more than 0% per point.' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { value: null, error: 'Use at most 2 decimal places.' };
  return { value, error: null };
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

// What each version in a History dialog did, as a StatusPill.
export const HISTORY_ACTIONS = {
  created: { label: 'Created', tone: 'success' },
  updated: { label: 'Updated', tone: 'info' },
  reset: { label: 'Reset', tone: 'info' },
  archived: { label: 'Archived', tone: 'muted' },
  restored: { label: 'Restored', tone: 'success' },
};

/**
 * 'voucher' or 'promotion'. Rows from before vouchers could be added carry
 * no `kind`; the backend's one voucher mechanic is keyed 'voucher'.
 *
 * @param {object} row a setting row
 */
export function mechanicKind(row) {
  return row.kind ?? (row.mechanic_key === 'voucher' ? 'voucher' : 'promotion');
}

/**
 * What one uplift version changed compared with the version before it
 * (null for the first one), a key of HISTORY_ACTIONS.
 *
 * @param {object} version
 * @param {object | null} previous
 */
export function upliftHistoryAction(version, previous) {
  if (!previous) return 'created';
  if (version.archived_at && !previous.archived_at) return 'archived';
  if (!version.archived_at && previous.archived_at) return 'restored';
  if (version.source === 'rule_based' && previous.source !== 'rule_based') return 'reset';
  return 'updated';
}

/**
 * The same for an ordinary-month discount. A customer starts on the value
 * suggested from its data with no saved version, so every version is a change
 * from something: a typed value is an update, one with no value is "Use
 * suggested value", i.e. a reset.
 *
 * @param {object} version
 */
export function anchorHistoryAction(version) {
  return version.anchor_pct == null ? 'reset' : 'updated';
}

/**
 * Whether a setting row applies to the picked Customer and SKU filters, the
 * same way the Scenario builder picks values (backend promo_uplifts._applies):
 * an all-customers row always applies, a customer row to every SKU of that
 * customer, a range row to the SKUs in that range, a SKU row to that SKU.
 * An empty filter means "any".
 *
 * @param {object} row a setting row
 * @param {{ customer: string, sku: string }} filters customer_name and SKU code, '' for any
 * @param {object | null} skuRow the picked catalogue SKU ({ sku, sku_range }), null for any
 */
export function upliftRowApplies(row, filters, skuRow) {
  if (row.scope === 'all') return true;
  if (filters.customer && row.customer_name !== filters.customer) return false;
  if (!skuRow) return true;
  if (row.scope === 'range') return row.sku_range === skuRow.sku_range;
  if (row.scope === 'sku') return row.sku === skuRow.sku;
  return true;
}

function rulePreviewRows(settings, before, after) {
  return settings
    .filter((row) => row.scope === 'all' && row.follows_rule && !row.archived_at)
    .map((row) => ({
      mechanicKey: row.mechanic_key,
      label: row.mechanic_label,
      before: ruleBasedUplift(row.effective_discount_pct, before.anchor, before.rate),
      after: ruleBasedUplift(row.effective_discount_pct, after.anchor, after.rate),
      capped: ruleBasedUpliftCapped(row.effective_discount_pct, after.anchor, after.rate),
    }));
}

/**
 * Before/after of every rule-based uplift when an anchor moves, for the
 * anchor form's preview. Rows that do not follow the rule are left out.
 *
 * @param {object[]} settings all-customers setting rows
 * @param {number} currentAnchor
 * @param {number} nextAnchor
 * @param {number} [rate]
 */
export function anchorPreview(settings, currentAnchor, nextAnchor, rate = DEFAULT_UPLIFT_PER_POINT_PCT) {
  return rulePreviewRows(settings, { anchor: currentAnchor, rate }, { anchor: nextAnchor, rate });
}

/**
 * Before/after of every rule-based uplift when the rule's rate changes, at
 * one anchor, for the rule dialog's preview.
 *
 * @param {object[]} settings all-customers setting rows
 * @param {number} anchorPct
 * @param {number} currentRate
 * @param {number} nextRate
 */
export function ratePreview(settings, anchorPct, currentRate, nextRate) {
  return rulePreviewRows(settings, { anchor: anchorPct, rate: currentRate }, { anchor: anchorPct, rate: nextRate });
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

export const EMPTY_MECHANIC_FORM = { kind: 'promotion', label: '', discount: '', uplift: '', note: '' };

/**
 * Check the Add promotion or voucher form and build its payload. A
 * promotion needs its discount; a voucher may have none (e.g. "$5 off $50"),
 * and then needs an uplift, since the rule works from the discount.
 * An empty uplift means "use the rule-based uplift".
 *
 * @param {typeof EMPTY_MECHANIC_FORM} form
 * @returns {{ errors: Record<string, string>, payload: object | null }}
 */
export function validateMechanicForm(form) {
  const errors = {};
  const label = form.label.trim();
  if (!label) errors.label = 'Enter a name, e.g. "Buy 3 Get 1 Free".';
  else if (label.length > 100) errors.label = 'Use at most 100 characters.';

  const hasDiscount = form.discount.trim() !== '';
  const discount = hasDiscount ? parseAnchorInput(form.discount) : { value: null, error: null };
  if (discount.error) errors.discount = discount.error;
  else if (!hasDiscount && form.kind === 'promotion') errors.discount = 'Enter the discount this promotion gives.';

  const hasUplift = form.uplift.trim() !== '';
  const uplift = hasUplift ? parseUpliftInput(form.uplift) : { value: null, error: null };
  if (uplift.error) errors.uplift = uplift.error;
  else if (!hasUplift && !hasDiscount && form.kind === 'voucher') {
    errors.uplift = 'A voucher with no discount needs an uplift.';
  }

  if (Object.keys(errors).length) return { errors, payload: null };
  return {
    errors,
    payload: {
      kind: form.kind,
      mechanic_label: label,
      effective_discount_pct: discount.value,
      uplift_pct: uplift.value,
      note: form.note.trim() || null,
    },
  };
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

// ============================================================
// MEASUREMENT (backend app/services/settings/promo_measurement.py)
// ============================================================

const OUTCOME_LABELS = {
  applied: 'Measured value in use',
  unchanged: 'Measured again, no change',
  held_backtest: 'Held: the backtest pointed the other way',
  no_evidence: 'No evidence yet',
  estimate_pending: 'Your typed uplift is kept',
  skipped: 'Not measured',
};

/**
 * What a measurement did with an uplift, in words.
 *
 * @param {string} outcome a promo_measurement_results outcome
 */
export function outcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

function months(value) {
  if (value == null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} month${rounded === 1 ? '' : 's'}`;
}

function pct(value) {
  return value == null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value * 10) / 10)}%`;
}

/**
 * The evidence panel's rows for one measurement result (getPromoUpliftEvidence),
 * as [label, value] pairs in reading order.
 *
 * @param {object} result
 */
export function evidenceDetails(result) {
  const forSku = Boolean(result.sku);
  const rows = [
    ['Outcome', outcomeLabel(result.outcome)],
    [forSku ? 'Blended SKU uplift' : 'Blended customer uplift', pct(result.blended_pct)],
  ];
  if (forSku) {
    rows.push(
      ["SKU's own uplift", pct(result.sku_own_pct)],
      ['SKU months of evidence', months(result.n)],
      ['Blended customer uplift (its starting point)', pct(result.blended_customer_pct)],
    );
  }
  rows.push(
    ["Customer's own uplift", pct(result.customer_own_pct)],
    ['Customer months of evidence', months(result.big_n)],
    ['Rule-based uplift (the customer\'s starting point)', pct(result.rule_based_pct)],
    ['Starting weight (k)', result.starting_weight == null ? '—' : String(result.starting_weight)],
    [
      'Backtest check',
      result.backtest_pct == null ? 'No check' : `${pct(result.backtest_pct)} over ${months(result.backtest_months)}`,
    ],
    ['Trend', result.method === 'flat' ? 'Flat average (under 6 months of history)' : result.method === 'trend' ? 'Trend line' : '—'],
    ['Data window', result.window_start ? `${result.window_start.slice(0, 7)} to ${result.window_end.slice(0, 7)}` : '—'],
  );
  if (result.reason) rows.push(['Why', result.reason]);
  return rows;
}

/**
 * What a settings save's measurement did, as the end of its toast. A save
 * that wrote a new version measures in the same request and answers its run
 * summary as `measurement` (backend routers/settings/promo_uplifts._measured).
 * Empty when nothing ran, the run was skipped or no value moved.
 *
 * @param {{ status: string, counts?: object } | undefined} measurement
 */
export function measurementToastSuffix(measurement) {
  if (!measurement) return '';
  if (measurement.status === 'failed') return ' · re-measuring failed, see Measured from sales data';
  const applied = measurement.counts?.applied ?? 0;
  if (!measurement.status.startsWith('succeeded') || applied === 0) return '';
  return ` · ${applied} measured uplift${applied === 1 ? '' : 's'} updated`;
}

/**
 * The one-line status under the Re-measure button.
 *
 * @param {object | null} status getPromoMeasurementStatus
 * @param {(iso: string) => string} formatDateTime
 */
export function measurementStatusLine(status, formatDateTime) {
  if (!status) return '';
  const last = status.last_success;
  return last ? `Last measured ${formatDateTime(last.finished_at)}` : 'Not measured yet';
}

/**
 * A note's headline: "Fairprice · 30% Off · Aire Adult Pants L" or
 * "Fairprice · ordinary-month discount".
 *
 * @param {object} note getPromoUpliftNotes row
 * @param {(key: string) => string} labelForKey mechanic key -> label
 */
export function noteTitle(note, labelForKey) {
  const customer = retailerLabel(note.customer_name ?? '');
  if (note.note_type === 'anchor') return `${customer} · ordinary-month discount`;
  const parts = [customer, labelForKey(note.mechanic_key)];
  if (note.product_name || note.sku) parts.push(note.product_name ?? note.sku);
  return parts.join(' · ');
}
