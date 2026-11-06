// Wording for forecast notifications in the bell (NotificationPanel). Pure and
// import-free so `npm test` (node --test) can check it without a browser.
//
// The payload shape is backend app/services/forecast_notifications.py:
//   run_name, source ('event' | 'scheduled' | 'script'),
//   stage ('pipeline' | 'refresh'; refresh = the retrain never started),
//   reason, errors[], period_start, period_end, customers[], skus[], updated_at.
// Notifications written before `stage`/`reason` existed have neither, so both
// are optional here: no stage means 'pipeline'.

// 'event' is any save in the app that changes forecast inputs (sales upload,
// promotion, SKU archive/restore) -- see backend forecast_refresh_events.
const STARTED_BY = {
  event: 'Sales/promotion change',
  scheduled: 'Scheduled run',
};

/**
 * True when the retrain never started (data didn't reach BigQuery in time,
 * or Cloud Tasks ran out of retries) -- a different message from a retrain
 * that ran and failed.
 *
 * @param {{ stage?: string }} payload
 * @param {boolean} success
 */
export function isRefreshFailure(payload, success) {
  return !success && payload?.stage === 'refresh';
}

/**
 * The card title. `date` is the already-formatted day (the panel formats
 * updated_at with lib/formatDate), so this stays free of imports.
 *
 * @param {object} payload
 * @param {boolean} success
 * @param {string} date
 */
export function forecastTitle(payload, success, date) {
  if (success) return `[SUCCESS] Forecast Pipeline Completed – ${date}`;
  if (isRefreshFailure(payload, success)) return `[FAILURE] Forecast refresh couldn't start – ${date}`;
  return `[FAILURE] Forecast Pipeline Failed – ${date}`;
}

/**
 * The sentence under the title.
 *
 * @param {object} payload
 * @param {boolean} success
 */
export function forecastIntro(payload, success) {
  if (success) {
    return 'The sales forecasting pipeline has completed successfully, and the latest forecast is ready for review.';
  }
  if (isRefreshFailure(payload, success)) {
    return 'The forecast refresh could not start, so the forecast was not updated after the latest changes.';
  }
  return 'The sales forecasting pipeline encountered an error and did not complete.';
}

/**
 * "Started by" value. Anything other than an app save or the schedule is the
 * forecast script (older notifications have no source at all).
 *
 * @param {string | undefined} source
 */
export function startedByLabel(source) {
  return STARTED_BY[source] ?? 'Forecast script';
}

/**
 * Error lines worth listing under the reason: the reason is usually the
 * job's first error, so it is not repeated.
 *
 * @param {{ reason?: string | null, errors?: string[] }} payload
 */
export function forecastErrorLines(payload) {
  const errors = payload?.errors ?? [];
  return errors.filter((error) => error && error !== payload?.reason);
}
