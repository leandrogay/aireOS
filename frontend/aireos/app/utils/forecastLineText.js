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

// The selected model has no Initial for any SKU in scope: a tier can be
// available with no Initial when the SKU had under 12 months of history when
// the yearly plan was made.
export const INITIAL_MISSING_HINT =
  'No Initial yearly forecast for this model — it needs 12+ months of history at the time the yearly plan was made.';

/**
 * Note when only some SKUs in scope have an Initial on the selected model, so
 * the Initial line is the sum of those SKUs only. '' when all or none do (none
 * is INITIAL_MISSING_HINT).
 *
 * @param {{ withInitial: number, total: number }} coverage
 */
export function initialPartialNote({ withInitial, total }) {
  if (!total || withInitial === 0 || withInitial === total) return '';
  const missing = total - withInitial;
  return (
    `Initial yearly forecast on this model covers ${withInitial} of ${total} SKUs, so that line adds up those ${withInitial} only: ` +
    `the other ${missing} had under 12 months of history when the yearly plan was made.`
  );
}

export const PREVIOUS_HINT =
  "Previous: the final forecast made on the month before, for comparison. Updates within the same month don't change it.";

// Previous stays empty until the forecast dataset has a second month of sales.
export const PREVIOUS_EMPTY_HINT = 'Appears after the next month of sales.';

export const CURRENT_HINT =
  'Current: the latest forecast, made on the newest month of sales. It updates automatically ' +
  'about 5–10 minutes after sales, promotions or products are changed.';

// Adding up per-SKU bounds overstates the range of the total, so the band
// only shows for one series (see the Forecast page).
const PICK_ONE_SERIES = 'Pick one SKU and customer to see the 80% range: added-up ranges would overstate it.';

/**
 * Hover text for each line pill, by series key.
 *
 * @param {{ singleSeries: boolean, initialMissingForSku: boolean, previousAvailable: boolean }} options
 */
export function forecastLineHints({ singleSeries, initialMissingForSku, previousAvailable }) {
  return {
    actual: ACTUAL_HINT,
    initial: initialMissingForSku ? INITIAL_MISSING_HINT : INITIAL_HINT,
    previous: previousAvailable ? PREVIOUS_HINT : PREVIOUS_EMPTY_HINT,
    current: singleSeries ? CURRENT_HINT : `${CURRENT_HINT} ${PICK_ONE_SERIES}`,
  };
}

/**
 * Whether the chart has any Previous value to draw. With none, the Previous
 * pill is greyed out (not hidden) so people know the line exists.
 *
 * @param {Array<{ previous?: number | null }>} points
 */
export function hasPreviousLine(points) {
  return (points ?? []).some((point) => point?.previous != null);
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

// "All customers" adds every customer up, and each customer's forecast is the
// average of its models, so there is no one model to pick.
export const ALL_MODELS_AVERAGE_LABEL = 'Average of all models';

export const ALL_MODELS_AVERAGE_NOTE =
  "All customers: each customer's forecast is the average of its available models, then added up across customers. " +
  'Pick one customer to choose a model.';

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
  "This month = how wide the model's 80% range is for this month. " +
  "Past accuracy = the model's average error (sMAPE) when tested on recent months we hid from it.";

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
