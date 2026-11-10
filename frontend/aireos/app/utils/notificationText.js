import { formatDate } from '@/lib/formatDate';
import { forecastWarningLines, isRefreshFailure } from '@/app/utils/forecastNotificationText';
import { customerLabel } from '@/app/utils/retailerLabel';
import { modelFeaturesText } from '@/app/utils/aiModels';

// ==== Notification headings ====
// The backend stores structured `payload` fields, not text (see backend
// notification_service), so the wording lives here and can change without a
// migration. A heading is a short category tag (shown as a pill, with a tone
// for StatusPill) plus a title; the tag used to be written into the title as
// "[STOCK ALERT] ...".

function lowStockHeading(payload) {
  return {
    tag: 'Stock alert',
    tone: 'warning',
    title: payload.items
      ? `Low stock detected for ${payload.count} SKUs`
      : `Low stock detected for ${payload.product_name}`,
  };
}

// The three cases follow forecastNotificationText.forecastTitle (a refresh
// that never started is its own failure), worded for the tag + title layout.
function forecastHeading(payload, success) {
  // The run's Singapore date: formatDate shows a full timestamp in Singapore
  // time. Slicing the UTC string would name the day before for a run between
  // midnight and 8am Singapore time.
  const date = formatDate(payload.updated_at);
  if (success) {
    // A retrain that worked but left the Initial yearly forecast unrefreshed
    // (payload `warnings`) says so in the title too.
    const completed = forecastWarningLines(payload).length
      ? 'Forecast pipeline completed with a warning'
      : 'Forecast pipeline completed';
    return { tag: 'Success', tone: 'success', title: `${completed} – ${date}` };
  }
  if (isRefreshFailure(payload, success)) {
    return { tag: 'Failure', tone: 'danger', title: `Forecast refresh couldn't start – ${date}` };
  }
  return { tag: 'Failure', tone: 'danger', title: `Forecast pipeline failed – ${date}` };
}

// ==== AI model outdated (model_outdated) ====
// Payload contract -- what the backend producer (ai_models.record_unavailable)
// sends; see ModelDetails in components/layout/NotificationDetails.jsx:
//   features         ['mapping', 'assistant']  every feature on that model
//   settings         ['MAPPING_MODEL', 'GEMINI_ASSISTANT_MODEL']  the settings to change
//   current_model    e.g. 'gemini-3.8-flash'
//   status           'retiring' (still works, has an end date) | 'retired' (calls now fail)
//   retires_on       'YYYY-MM-DD' calendar date, or null when unknown
//   suggested_model  a newer model to switch to, or null
// The wording is in utils/aiModels.js, shared with the pages' notices.

function modelHeading(payload) {
  const features = modelFeaturesText(payload.features);
  return {
    tag: 'AI model',
    tone: 'model',
    title: payload.status === 'retired' ? `AI model retired – ${features}` : `AI model retiring soon – ${features}`,
  };
}

const HEADINGS = {
  low_stock: lowStockHeading,
  forecast_success: (payload) => forecastHeading(payload, true),
  forecast_failure: (payload) => forecastHeading(payload, false),
  mapping_uploaded: (payload) => ({
    tag: 'Nomenclature',
    tone: 'info',
    title: `${payload.amended ? 'Nomenclature updated' : 'New nomenclature approved'} – ${payload.name}`,
  }),
  rollback_success: () => ({ tag: 'Success', tone: 'success', title: 'Upload rolled back' }),
  rollback_failure: () => ({ tag: 'Failure', tone: 'danger', title: 'Upload rollback failed' }),
  model_outdated: modelHeading,
};

/**
 * The tag, tone and title for one notification, by notification_type. An
 * unknown type still gets a plain heading so a new producer never breaks the bell.
 *
 * @param {string} type
 * @param {object} payload
 * @returns {{ tag: string, tone: string, title: string }}
 */
export function notificationHeading(type, payload) {
  const heading = HEADINGS[type];
  return heading ? heading(payload ?? {}) : { tag: 'Notice', tone: 'muted', title: 'Notification' };
}

/**
 * Days of holding left, as shown in a low-stock alert: one decimal at most
 * ("0.2", "3"), since the backend sends the raw ratio (stock / daily
 * sell-out), which can have many decimals. null when there is no usable
 * figure (no sell-out that month, so no daily rate to divide by).
 *
 * @param {number | string | null | undefined} value payload doh_remaining
 * @returns {string | null}
 */
export function daysLeftValue(value) {
  const days = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(days)) return null;
  return String(Math.round(days * 10) / 10);
}

/** "0.2 days left", "1 day left", or "Days left unknown" when there is no figure. */
export function daysLeftText(value) {
  const days = daysLeftValue(value);
  if (days === null) return 'Days left unknown';
  return `${days} day${days === '1' ? '' : 's'} left`;
}

/** One SKU of a consolidated low-stock alert, e.g. "Diapers M (Fairprice) — 3 days left". */
export function lowStockItemText(item) {
  return `${item.product_name} (${customerLabel(item.customer_name)}) — ${daysLeftText(item.doh_remaining)}`;
}
