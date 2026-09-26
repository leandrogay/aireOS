import { request } from '@/app/services/promotionsApi';

// Wrappers for /api/settings (backend app/routers/settings/), one section per
// kind of customer-level setting.

// Who every settings change made from the frontend is recorded as (the
// backend's optional `updated_by`). The wrappers below attach it themselves so
// no caller can leave it out.
// TODO: replace with the signed-in user once authentication is added.
export const UPDATED_BY = 'aireos';

// ============================================================
// DOH settings: /api/settings/doh (backend app/routers/settings/doh.py)
//
// Threshold values come back as JSON numbers. Saves and reverts answer with
// `{ changed, settings }`: `changed` is false when the values matched the
// current version and nothing was written (the backend also sends 200
// instead of 201 then).
// ============================================================

/**
 * GET /api/settings/doh
 *
 * One row per customer. A customer that has never had thresholds saved gets
 * the global defaults (setting_id and thresholds_updated_* null);
 * `is_global_default` is also true when the saved values equal the defaults.
 *
 * @returns {Promise<Array<{ customer_id: number, customer_name: string, doh_alert_enabled: boolean, doh_alert_updated_at: string, setting_id: number | null, min_doh: number, target_doh: number, max_doh: number, is_global_default: boolean, thresholds_updated_at: string | null, thresholds_updated_by: string | null }>>}
 */
export async function getDohSettings() {
  return request('/api/settings/doh');
}

/**
 * GET /api/settings/doh/{customerId}
 *
 * @param {number} customerId
 * @returns {Promise<object>} the same row shape as getDohSettings
 */
export async function getCustomerDohSettings(customerId) {
  return request(`/api/settings/doh/${encodeURIComponent(customerId)}`);
}

/**
 * PUT /api/settings/doh/{customerId}/thresholds
 *
 * Saves a new version unless the values equal the current one. Values allow
 * at most 2 decimal places and must satisfy min <= target <= max.
 *
 * @param {number} customerId
 * @param {{ min_doh: number, target_doh: number, max_doh: number }} payload sent with `updated_by: UPDATED_BY`
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function saveDohThresholds(customerId, payload) {
  return request(`/api/settings/doh/${encodeURIComponent(customerId)}/thresholds`, {
    method: 'PUT',
    body: { ...payload, updated_by: UPDATED_BY },
  });
}

/**
 * POST /api/settings/doh/{customerId}/reset
 *
 * Puts the customer back on the global default thresholds (saved as a new
 * version; `changed` is false when it was already on them). Recorded as
 * updated by UPDATED_BY.
 *
 * @param {number} customerId
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function resetDohThresholds(customerId) {
  return request(`/api/settings/doh/${encodeURIComponent(customerId)}/reset`, {
    method: 'POST',
    body: { updated_by: UPDATED_BY },
  });
}

/**
 * PUT /api/settings/doh/{customerId}/alert
 *
 * Sends no `updated_by`: the alert flag lives on customers, which only
 * records when it changed (doh_alert_updated_at), not who changed it.
 *
 * @param {number} customerId
 * @param {{ doh_alert_enabled: boolean }} payload
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function setDohAlert(customerId, payload) {
  return request(`/api/settings/doh/${encodeURIComponent(customerId)}/alert`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * GET /api/settings/doh/{customerId}/history
 *
 * Threshold versions, newest first. `limit` is 1-100 (default 20).
 *
 * @param {number} customerId
 * @param {{ limit?: number, offset?: number }} [paging]
 * @returns {Promise<{ customer_id: number, total: number, limit: number, offset: number, items: Array<{ setting_id: number, min_doh: number, target_doh: number, max_doh: number, updated_at: string, updated_by: string | null, is_current: boolean }> }>}
 */
export async function getDohHistory(customerId, { limit, offset } = {}) {
  const search = new URLSearchParams();
  if (limit !== undefined) search.set('limit', String(limit));
  if (offset !== undefined) search.set('offset', String(offset));
  const query = search.toString();

  return request(
    `/api/settings/doh/${encodeURIComponent(customerId)}/history${query ? `?${query}` : ''}`,
  );
}

/**
 * POST /api/settings/doh/{customerId}/history/{settingId}/revert
 *
 * Makes an older version current by saving a copy of its values as a new
 * version; the old version is kept. Recorded as updated by UPDATED_BY.
 *
 * @param {number} customerId
 * @param {number} settingId
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function revertDohThresholds(customerId, settingId) {
  return request(
    `/api/settings/doh/${encodeURIComponent(customerId)}/history/${encodeURIComponent(settingId)}/revert`,
    { method: 'POST', body: { updated_by: UPDATED_BY } },
  );
}
