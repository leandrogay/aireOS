// Wording for the Forecast page's line pills and "last updated" stamp
// (forecast-frontend-update-handover F2-F6). Pure and import-free so
// `npm test` (node --test) can check it without the Next.js aliases.
//
// The wording follows how the BigQuery forecast works now: it retrains on its
// own a few minutes after an app save (backend forecast_refresh_worker), the
// Initial Yearly Forecast is built from September sales and locked at year
// end, and each customer's actuals stop at that customer's latest file.

export const FORECAST_LAST_UPDATED_LABEL = 'Forecast last updated';

export const ACTUAL_HINT =
  'Actual: sales received so far. Each customer\'s actuals end at their latest file, ' +
  'so months can differ between customers.';

export const INITIAL_HINT =
  "Initial Yearly Forecast: the plan for the year. It's created when the first September sales arrive, " +
  "updated automatically as that year's promotions are entered and October/November sales arrive, " +
  'and locked at 23:59 on 31 December.';

// The selected Tier 1 model has no Initial for any SKU in scope: Tier 1
// needs 12+ months of history at the time the yearly plan was made.
export const INITIAL_MISSING_HINT =
  'No Initial yearly forecast for this model — it needs 12+ months of history at the time the yearly plan was made.';

function joinYears(years) {
  const list = [...new Set(years ?? [])].sort((a, b) => a - b);
  if (list.length <= 1) return { text: String(list[0] ?? ''), plural: false };
  return { text: `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`, plural: true };
}

/**
 * Why the selected model draws no Initial for the SKUs in scope. Not an
 * error. Tier 0 (available for every SKU) has none only when the SKU
 * launched after that year's plan was made; Tier 1 needs 12+ months of
 * history when the plan was made.
 *
 * @param {{ tier: string, years: number[], skuCount?: number }} options years in the date range
 */
export function initialMissingHint({ tier, years, skuCount = 1 }) {
  if (tier !== 'tier0') return INITIAL_MISSING_HINT;
  const { text, plural } = joinYears(years);
  const subject = skuCount > 1 ? 'these SKUs' : 'this SKU';
  const plan = text ? `the ${text} ${plural ? 'plans were' : 'plan was'} made` : 'the yearly plan was made';
  return `No Initial yearly forecast: ${subject} launched after ${plan}.`;
}

/**
 * "Initial yearly forecast: shown for 3 of 5 selected SKUs." when only some
 * customer x SKUs in scope have the line on the selected model, so its sum is
 * never a silent partial. '' when all or none have it (none greys the pill).
 *
 * @param {string} lineLabel
 * @param {{ withLine: number, total: number }} coverage forecastActuals.lineCoverage
 */
export function lineCoverageNote(lineLabel, { withLine, total }) {
  if (!total || withLine === 0 || withLine === total) return '';
  return `${lineLabel}: shown for ${withLine} of ${total} selected SKUs.`;
}

export const PREVIOUS_HINT = "Previous: the forecast made before this SKU's latest month of sales.";

// The selected model has no Previous for any SKU in scope (per SKU and tier:
// forecast_previous on that tier's rows).
export const PREVIOUS_MISSING_HINT =
  'No Previous forecast for this model yet — it appears once this SKU has a forecast from an earlier month.';

export const CURRENT_HINT =
  'Current: the latest forecast, made on the newest month of sales. It updates automatically ' +
  'about 5–10 minutes after sales, promotions or products are changed.';

/**
 * Hover text for each line pill, by series key. `initialMissing` is the
 * reason the Initial pill is greyed out (initialMissingHint), '' when it
 * isn't; `previousMissing` greys out Previous.
 *
 * @param {{ initialMissing?: string, previousMissing?: boolean }} options
 */
export function forecastLineHints({ initialMissing = '', previousMissing = false } = {}) {
  return {
    actual: ACTUAL_HINT,
    initial: initialMissing || INITIAL_HINT,
    previous: previousMissing ? PREVIOUS_MISSING_HINT : PREVIOUS_HINT,
    current: CURRENT_HINT,
  };
}

// ============================================================
// MISSING AND PARTIAL ACTUALS (actual_status)
// ============================================================

// Values beside an "Actual" label in the tooltip (forecastActuals.monthNotes).
export const ACTUAL_MISSING_TEXT = 'missing (no sales file for this month)';

/** "partial — missing for Nhg (no sales file)"; customers already formatted. */
export function actualPartialMissingText(customers) {
  return `partial — missing for ${customers.join(', ')} (no sales file)`;
}

/** "Actuals for 3 of 5 SKUs; 2 still forecast for Aug" */
export function actualsStillForecastText({ reported, waiting, month }) {
  const total = reported + waiting;
  return `Actuals for ${reported} of ${total} SKUs; ${waiting} still forecast for ${month}`;
}

// The table never shows a missing month as "—" or 0.
export const TABLE_MISSING_LABEL = 'Missing';
export const TABLE_MISSING_HINT = 'No sales file for this month.';
export const TABLE_PARTIAL_LABEL = 'partial';
export const TABLE_PARTIAL_HINT = 'Adds up only the SKUs with an actual this month (see the chart tooltip).';

// Past this many SKUs, the Previous dates collapse to "+N more".
const PREVIOUS_ROW_LIMIT = 6;

/**
 * When a month's Previous values were made: one line when every SKU's came
 * from the same run, else one per SKU (Previous is chosen per SKU).
 *
 * @param {{ productName: string, customerName: string, at: string }[]} entries forecastActuals.previousMadeByMonth
 * @param {(stamp: string) => string} formatStamp Singapore time
 */
export function previousMadeLines(entries, formatStamp) {
  const stamps = [...new Set((entries ?? []).map((entry) => entry.at))];
  if (!stamps.length) return [];
  if (stamps.length === 1) return [`made ${formatStamp(stamps[0])}`];
  const severalCustomers = new Set(entries.map((entry) => entry.customerName)).size > 1;
  const lines = entries.map((entry) => {
    const name = severalCustomers ? `${entry.productName} (${entry.customerName})` : entry.productName;
    return `${name}: made ${formatStamp(entry.at)}`;
  });
  const shown = lines.slice(0, PREVIOUS_ROW_LIMIT);
  const more = lines.length - shown.length;
  return more > 0 ? [...shown, `+${more} more`] : shown;
}

// ============================================================
// MODEL (TIER) PICKER
// ============================================================

// One model at a time, never a recommended or mixed one: the client builds
// their own plan on the model they choose. Values and order match the view's
// tier / tier_order (backend bigquery.FORECAST_TIERS).
export const TIER0_HINT = "Baseline from recent sales and last year's pattern. Available for every SKU.";

export const FORECAST_TIER_OPTIONS = [
  { value: 'tier0', label: 'Tier 0 · Baseline', description: TIER0_HINT },
  {
    value: 'tier1_basic',
    label: 'Tier 1 · Basic (ARIMA_PLUS)',
    description: "Trend and seasonality learned from the SKU's own sales history.",
  },
  {
    value: 'tier1_advanced',
    label: 'Tier 1 · Advanced (ARIMA_PLUS_XREG)',
    description: 'Basic, plus the promotions entered for each month.',
  },
];

// unavailable_reason values from aire_forecasting_output.
export const UNAVAILABLE_REASON_TEXT = {
  not_enough_history: 'Needs 12+ months of sales history',
  incomplete_forecast: "This model didn't produce a full 12-month forecast",
  not_backtested: "Not tested on past months yet, so there's no accuracy score",
  no_familiar_promotions: 'No familiar promotions in the next 12 months',
  no_forecast: 'No forecast from this model yet',
};

const UNAVAILABLE_FALLBACK = 'Not available for this SKU';

export function unavailableReasonText(reason) {
  return UNAVAILABLE_REASON_TEXT[reason] ?? UNAVAILABLE_FALLBACK;
}

/**
 * Why a model can't be picked for the SKUs in scope. One SKU: its reason.
 * Several: how many can't use it, plus the reason when they all share one.
 *
 * @param {{ reasons: (string | null)[], total: number }} options one reason per SKU that can't use it
 */
export function tierUnavailableText({ reasons, total }) {
  if (!reasons.length) return '';
  if (total <= 1) return unavailableReasonText(reasons[0]);
  const shared = new Set(reasons).size === 1 ? ` · ${unavailableReasonText(reasons[0])}` : '';
  return `Not available for ${reasons.length} of ${total} selected SKUs${shared}`;
}

export const NO_DATA_FOR_TIER = 'No forecast from this model matches these filters.';

// ============================================================
// CONFIDENCE (tooltip + past-accuracy badge)
// ============================================================

export const CONFIDENCE_BAND_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

/** A band from the view as a CONFIDENCE_BAND_LABELS key ('unknown' for NULL or anything else). */
export function confidenceBand(band) {
  return band in CONFIDENCE_BAND_LABELS ? band : 'unknown';
}

export const CONFIDENCE_INFO =
  "This month = how wide the model's 80% range is for this month (Current and Previous each have their own). " +
  "Past accuracy = the model's average error (sMAPE) when tested on recent months we hid from it; " +
  'one score for both lines, since the same model made them.';

// Band cut-offs, both "<= 20 high, <= 50 medium, else low": month_range_pct
// for This month, current_backtest_smape for Past accuracy.
export const CONFIDENCE_BANDS_INFO =
  'This month: High within ±20%, Medium within ±50%, Low wider. ' +
  'Past accuracy: High at sMAPE 20% or less, Medium up to 50%, Low above.';

export const THIS_MONTH_LABEL = 'This month';
export const PAST_ACCURACY_LABEL = 'Past accuracy';

/** "±30%", or '' when the view has no range for the month. */
export function rangePctText(pct) {
  return pct == null ? '' : `±${Math.round(pct)}%`;
}

/** "sMAPE 12%", or "not tested yet" with no backtest. */
export function smapeText(smape) {
  return smape == null ? 'not tested yet' : `sMAPE ${Math.round(smape)}%`;
}

/** "8 in 10 chance it lands between 700 and 1,300" from already-formatted bounds; '' without both. */
export function rangeChanceText(low, high) {
  if (!low || !high) return '';
  return `8 in 10 chance it lands between ${low} and ${high}`;
}

// The Current line's dots show this month's confidence by fill (one SKU and
// customer only), never by colour alone; the hover card repeats the same
// symbol beside its words, so the chart needs no separate key.
export const CURRENT_DOT_FILL = { high: 'filled', medium: 'half', low: 'hollow', unknown: 'small' };

/** "Low confidence" for a month_confidence_band (unknown for NULL). */
export function confidenceWords(band) {
  return `${CONFIDENCE_BAND_LABELS[confidenceBand(band)]} confidence`;
}

export const TYPICAL_PROMO_NOTE = "Promotion not familiar — model used this SKU's usual promotion.";

/** The SKU-level badge under the legend, e.g. "Past accuracy: High · sMAPE 12%". */
export function pastAccuracyBadgeLabel({ band, smape }) {
  return `${PAST_ACCURACY_LABEL}: ${CONFIDENCE_BAND_LABELS[confidenceBand(band)]} · ${smapeText(smape)}`;
}

export const PAST_ACCURACY_BADGE_HINT =
  "The model's average % error (sMAPE) on recent months we hid from it, the same for every month of this SKU. " +
  "Tier 0 is tested on 1 window and Tier 1 on 4, so the scores aren't exactly like-for-like.";

// ============================================================
// INITIAL YEARLY FORECAST STATUS (F7)
// ============================================================

const SGT_DAY = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A UTC ISO stamp as its Singapore calendar day, e.g. "31 Dec 2026"; '' when missing. */
export function sgtDay(stamp) {
  if (!stamp) return '';
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? '' : SGT_DAY.format(date);
}

/**
 * One note per year in the selected range whose Initial is still open (a row
 * in aire_forecasting_initial_meta that the backend hasn't marked `locked`):
 * "updating until <lock day>". Locked years and the 2026 backfill (values but
 * no row) get no note -- a fixed plan needs no explanation under the chart.
 *
 * @param {{
 *   rangeYears: number[],
 *   meta: { forecast_year: number, lock_at: string | null, refreshed_at: string | null, locked: boolean }[],
 *   formatStamp: (stamp: string) => string,
 * }} options formatStamp shows refreshed_at (the page passes formatSgtTimestamp)
 * @returns {string[]}
 */
export function initialStatusNotes({ rangeYears, meta, formatStamp }) {
  const metaByYear = new Map((meta ?? []).map((row) => [row.forecast_year, row]));
  return [...new Set(rangeYears ?? [])]
    .sort((a, b) => a - b)
    .flatMap((year) => {
      const row = metaByYear.get(year);
      if (!row || row.locked) return [];
      const until = sgtDay(row.lock_at);
      const updated = row.refreshed_at ? ` · last updated ${formatStamp(row.refreshed_at)}` : '';
      return [`${year} Initial: updating${until ? ` until ${until}` : ''}${updated}`];
    });
}

/** Every calendar year from startDate to endDate ('YYYY-MM-DD'), inclusive. */
export function yearsInRange(startDate, endDate) {
  const start = Number(String(startDate ?? '').slice(0, 4));
  const end = Number(String(endDate ?? '').slice(0, 4));
  if (!start || !end || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

// ============================================================
// "FORECAST UPDATING…" BADGE (F8)
// ============================================================

export const FORECAST_UPDATING_LABEL = 'Forecast updating…';

export const FORECAST_UPDATING_HINT =
  "A change was saved; the forecast refreshes about 5–10 minutes after the last change. You'll get a notification when it's done.";

// A refresh that retrains nothing writes no notification, so while the badge
// shows the page re-checks on this timer until the status clears.
export const REFRESH_STATUS_RECHECK_MS = 60_000;

// The same retrain also rebuilds an open Initial Yearly Forecast (from its
// September build until it locks at year end), so while one is open the badge
// names the Initial line too.
export const INITIAL_UPDATING_LABEL = 'Initial Yearly Forecast updating…';

export const INITIAL_UPDATING_HINT =
  'A change was saved; the forecast, including the Initial Yearly Forecast (open until it locks on ' +
  "31 December), refreshes about 5–10 minutes after the last change. You'll get a notification when it's done.";

/**
 * The badge for a refresh-status response, or null when nothing is updating.
 * `initialMeta` (GET /api/forecast/initial-status years) decides the wording:
 * any year not yet locked means this refresh also moves the Initial line.
 *
 * @param {{ updating?: boolean } | null | undefined} status
 * @param {{ locked: boolean }[]} [initialMeta]
 */
export function forecastUpdatingBadge(status, initialMeta = []) {
  if (!status?.updating) return null;
  const initialOpen = (initialMeta ?? []).some((row) => !row.locked);
  return initialOpen
    ? { label: INITIAL_UPDATING_LABEL, hint: INITIAL_UPDATING_HINT }
    : { label: FORECAST_UPDATING_LABEL, hint: FORECAST_UPDATING_HINT };
}

/** Milliseconds until the next status check: only while updating, else null (stop). */
export function nextStatusCheckDelay(status) {
  return status?.updating ? REFRESH_STATUS_RECHECK_MS : null;
}
