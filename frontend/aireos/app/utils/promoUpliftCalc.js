// ============================================================
// WORKED-OUT PROMOTION UPLIFTS -- pure, import-free (tests/promoUpliftCalc.test.mjs)
// ============================================================
//
// Display helpers for the calculated uplifts on Promotion Uplift Settings
// (GET /api/settings/promo-uplifts/calculated, backend
// settings/promo_uplift_calc.calculated_rows). A row is one customer x SKU
// range x mechanic; its `versions` are the anchor versions from this month on,
// each with every SKU of the range. Uplifts are never typed here: the level
// says how each was worked out (promo_anchor_versions.choose_uplift).

// The five levels, most direct first (backend promo_uplift_calc.LEVEL_ORDER).
// "Edited for this scenario" is the Scenario builder's own, never here.
const LEVEL_LABELS = {
  anchor: 'Anchor',
  measured: 'Measured · current anchor',
  measured_earlier: 'Measured · includes earlier anchor',
  placeholder: 'Placeholder · rule',
  unavailable: 'Unavailable',
};

// Measured is from data (info), a caveat worth noticing warning, and the
// rest muted: the anchor is 0 by definition, the rule is a stand-in.
const LEVEL_TONES = {
  anchor: 'muted',
  measured: 'info',
  measured_earlier: 'warning',
  placeholder: 'muted',
  unavailable: 'muted',
};

/** @param {string} level */
export function levelLabel(level) {
  return LEVEL_LABELS[level] ?? level;
}

/** @param {string} level */
export function levelTone(level) {
  return LEVEL_TONES[level] ?? 'muted';
}

// Same as scenarioPromotions.formatPct, which imports '@/' paths and so
// can't be loaded by node --test.
function signedPct(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${number}%`;
  if (number < 0) return `−${Math.abs(number)}%`;
  return '0%';
}

/**
 * A version's uplift: "+4%", "+4% to +9%" when its SKUs differ, "—" when
 * none can be worked out.
 *
 * @param {{ uplift_min: number | null, uplift_max: number | null }} version
 */
export function upliftText(version) {
  if (version.uplift_min == null) return '—';
  if (version.uplift_min === version.uplift_max) return signedPct(version.uplift_min);
  return `${signedPct(version.uplift_min)} to ${signedPct(version.uplift_max)}`;
}

/**
 * Whether a version's SKUs have different values or levels, so its row
 * opens to them.
 *
 * @param {{ skus: object[] }} version
 */
export function skusDiffer(version) {
  const first = version.skus[0];
  if (!first) return false;
  return version.skus.some((sku) => sku.level !== first.level || sku.uplift_pct !== first.uplift_pct);
}

// 'YYYY-MM-01' → "Jun 2027" (dates are calendar months, never shifted).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {string | null} iso 'YYYY-MM-DD' */
export function monthText(iso) {
  if (!iso) return '';
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/**
 * An anchor version in words: "20% Off · 20%" or "20% off" (no mechanic: the
 * fallback, or a discount typed before anchors were mechanics).
 *
 * @param {{ mechanic_label: string | null, anchor_pct: number }} anchor
 */
export function versionAnchorText(anchor) {
  return anchor.mechanic_label ? `${anchor.mechanic_label} · ${anchor.anchor_pct}%` : `${anchor.anchor_pct}% off`;
}

/**
 * The second line under a row's value: the next version, "from Jun 2027:
 * +6%", or null with none.
 *
 * @param {{ versions: object[] }} row
 */
export function upcomingText(row) {
  const next = row.versions[1];
  return next ? `from ${monthText(next.effective_from)}: ${upliftText(next)}` : null;
}

/**
 * The version a value is measured against: "Anchor: 15% Off · 15% from Dec 2026."
 *
 * @param {{ mechanic_label: string | null, anchor_pct: number, effective_from: string | null }} versionAnchor
 */
export function anchorLine(versionAnchor) {
  const since = versionAnchor.effective_from ? ` from ${monthText(versionAnchor.effective_from)}` : '';
  return `Anchor: ${versionAnchorText(versionAnchor)}${since}.`;
}

/**
 * How one SKU's value was reached, as lines for its 'i' card: the anchor
 * version it is measured against, then the months it averages (with any
 * conversion from an earlier anchor and an all-time baseline), or the
 * placeholder sum.
 *
 * @param {{ level: string, uplift_pct: number | null, anchor: object | null, moments: object[], placeholder: object | null }} value
 * @param {{ mechanic_label: string | null, anchor_pct: number, effective_from: string | null }} versionAnchor the version's anchor, as the row shows it
 */
export function explanationLines(value, versionAnchor) {
  const lines = [anchorLine(versionAnchor)];

  if (value.level === 'anchor') {
    lines.push('This mechanic is the anchor, so it is an ordinary month: 0%.');
    return lines;
  }
  if (value.level === 'unavailable') {
    lines.push('No moments, and no discount to apply the placeholder rule to.');
    return lines;
  }
  if (value.level === 'placeholder') {
    const { discount_pct: discount, anchor_pct: anchor } = value.placeholder ?? {};
    lines.push(`Fewer than 3 moments, so the rule: (${discount}% − ${anchor}%) ÷ 5 × 2 = ${signedPct(value.uplift_pct)}.`);
    return lines;
  }

  lines.push(`Average of the latest ${value.moments.length} moments:`);
  for (const moment of value.moments) {
    let line = `${monthText(moment.month)}: ${signedPct(moment.used_pct ?? moment.uplift_pct)}`;
    if (moment.converted) {
      const how = moment.converted.source === 'placeholder' ? 'by the placeholder rule' : 'as measured';
      line += ` (${signedPct(moment.uplift_pct)} against an earlier anchor, converted ${how})`;
    }
    if (moment.baseline_source === 'all_time') line += ', against every month at the anchor';
    lines.push(line);
  }
  return lines;
}

/**
 * The rows for the Customer / SKU range / Mechanic filters ('' = all): "All"
 * is every combination, never a row of its own.
 *
 * @param {object[]} rows from getCalculatedUplifts
 * @param {{ customer: string, skuRange: string, mechanic: string }} filters
 */
export function filterCalculatedRows(rows, filters) {
  return rows.filter(
    (row) =>
      (!filters.customer || row.customer_name === filters.customer)
      && (!filters.skuRange || row.sku_range === filters.skuRange)
      && (!filters.mechanic || row.mechanic_key === filters.mechanic),
  );
}

/**
 * The calculation status of the customers in view, for the pill by
 * Recalculate: a failure wins, then anything waiting, else up to date.
 *
 * @param {Record<string, { pending?: boolean, last_error?: string | null, calculated_at?: string | null }>} statuses by customer id
 * @returns {{ label: string, tone: string, error: string | null }}
 */
export function calcStatus(statuses) {
  const items = Object.values(statuses ?? {});
  const failed = items.find((item) => item.last_error);
  if (failed) return { label: 'Last run failed', tone: 'danger', error: failed.last_error };
  if (items.some((item) => item.pending)) return { label: 'Waiting to recalculate', tone: 'info', error: null };
  if (items.some((item) => !item.calculated_at)) return { label: 'Not calculated yet', tone: 'muted', error: null };
  return { label: 'Up to date', tone: 'success', error: null };
}
