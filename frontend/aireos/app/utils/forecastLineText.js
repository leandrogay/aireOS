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

// One SKU with no Initial values in the chosen months. Today the only cause
// is the 6-month history minimum (Ultra Tape in the 2026 backfill).
export const INITIAL_MISSING_HINT =
  "No Initial Yearly Forecast for this SKU in this period: it had under 6 months of sales history when that year's plan was made.";

export const PREVIOUS_HINT =
  "Previous: the final forecast made on the month before, for comparison. Updates within the same month don't change it.";

// Previous stays empty until the forecast dataset has a second month of sales.
export const PREVIOUS_EMPTY_HINT = 'Appears after the next month of sales.';

export const CURRENT_HINT =
  'Current: the latest forecast, made on the newest month of sales. It updates automatically ' +
  'about 5–10 minutes after sales, promotions or products are changed.';

// The 80% range and confidence describe one series (see the Forecast page).
const PICK_ONE_SERIES = 'Pick one SKU and customer to see the 80% range and the forecast confidence.';

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
// MODEL HOVER (F9)
// ============================================================

// source_model value for Tier 0 (see SOURCE_MODEL_LABELS in forecastView.js).
const TIER0_MODEL = 'tier0_legacy';

export const TIER0_HINT =
  'Used for products with under 6 months of sales, or where it was more accurate than the Tier 1 models.';

/**
 * Hover text for a month's Model label: the Tier 0 explanation when any
 * series in that month was forecast by Tier 0, otherwise nothing.
 *
 * @param {Record<string, number> | null | undefined} currentModels source_model -> series count
 */
export function modelHint(currentModels) {
  return currentModels?.[TIER0_MODEL] ? TIER0_HINT : '';
}

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
 * One note per year in the selected range that has an Initial: a row in
 * aire_forecasting_initial_meta, or Initial values on the chart. A year with
 * a row is "updating until <lock day>" until it locks (backend decides
 * `locked`), then a fixed plan; a year with values but no row (2026, the
 * one-off backfill) is a fixed plan; a year with neither gets no note.
 *
 * @param {{
 *   rangeYears: number[],
 *   meta: { forecast_year: number, lock_at: string | null, refreshed_at: string | null, locked: boolean }[],
 *   yearsWithInitial: number[],
 *   formatStamp: (stamp: string) => string,
 * }} options formatStamp shows refreshed_at (the page passes formatSgtTimestamp)
 * @returns {string[]}
 */
export function initialStatusNotes({ rangeYears, meta, yearsWithInitial, formatStamp }) {
  const metaByYear = new Map((meta ?? []).map((row) => [row.forecast_year, row]));
  const withValues = new Set(yearsWithInitial ?? []);
  return [...new Set(rangeYears ?? [])]
    .sort((a, b) => a - b)
    .flatMap((year) => {
      const row = metaByYear.get(year);
      if (!row) return withValues.has(year) ? [`${year} Initial: fixed plan`] : [];
      if (row.locked) return [`${year} Initial: fixed plan`];
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

/** The badge for a refresh-status response, or null when nothing is updating. */
export function forecastUpdatingBadge(status) {
  return status?.updating ? { label: FORECAST_UPDATING_LABEL, hint: FORECAST_UPDATING_HINT } : null;
}

/** Milliseconds until the next status check: only while updating, else null (stop). */
export function nextStatusCheckDelay(status) {
  return status?.updating ? REFRESH_STATUS_RECHECK_MS : null;
}
