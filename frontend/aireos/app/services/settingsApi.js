import { request } from '@/app/services/promotionsApi';

// Wrappers for /api/settings (backend app/routers/settings/), one section per
// kind of customer-level setting.

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
 * One row per customer; threshold fields are null for a customer that has
 * never had thresholds saved.
 *
 * @returns {Promise<Array<{ customer_id: number, customer_name: string, doh_alert_enabled: boolean, doh_alert_updated_at: string, setting_id: number | null, min_doh: number | null, target_doh: number | null, max_doh: number | null, thresholds_updated_at: string | null, thresholds_updated_by: string | null }>>}
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
 * @param {{ min_doh: number, target_doh: number, max_doh: number, updated_by?: string }} payload
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function saveDohThresholds(customerId, payload) {
  return request(`/api/settings/doh/${encodeURIComponent(customerId)}/thresholds`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * PUT /api/settings/doh/{customerId}/alert
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
 * version; the old version is kept.
 *
 * @param {number} customerId
 * @param {number} settingId
 * @param {{ updated_by?: string }} [payload]
 * @returns {Promise<{ changed: boolean, settings: object }>}
 */
export async function revertDohThresholds(customerId, settingId, payload) {
  return request(
    `/api/settings/doh/${encodeURIComponent(customerId)}/history/${encodeURIComponent(settingId)}/revert`,
    { method: 'POST', body: payload },
  );
}
