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

// ============================================================
// Promotion Uplift Settings: /api/settings/promo-uplifts
// (backend app/routers/settings/promo_uplifts.py)
//
// Uplift per promotion mechanic, and each customer's ordinary-month discount
// (the "anchor" placeholder uplifts are measured from). Percentages come back
// as JSON numbers (4 means +4%). Writes answer with `{ changed, ... }`, like
// the DOH wrappers above.
// ============================================================

const PROMO_UPLIFTS = '/api/settings/promo-uplifts';

/**
 * GET /api/settings/promo-uplifts
 *
 * Every current uplift row (any scope), the all-customers anchor, and the
 * promotion mechanics in the promotions table that match no setting.
 *
 * @returns {Promise<{ settings: object[], default_anchor_pct: number, unmapped_mechanics: Array<{ promotion_mechanic: string, promotions: number }> }>}
 */
export async function getPromoUpliftSettings() {
  return request(PROMO_UPLIFTS);
}

/**
 * GET /api/settings/promo-uplifts/resolved?customer=&product=
 *
 * The uplift of every mechanic for one customer (forecast family name) and
 * product name ('' = all SKUs), as the Scenario builder uses it: placeholder
 * values already recalculated from the customer's anchor. For all SKUs,
 * `product_uplifts` lists products whose own value differs.
 *
 * @param {{ customer: string, product?: string }} scope
 * @returns {Promise<{ customer_name: string, product_name: string | null, anchor: object, uplifts: object[], product_uplifts: Record<string, Record<string, number>> }>}
 */
export async function getResolvedPromoUplifts({ customer, product = '' }) {
  const search = new URLSearchParams({ customer });
  if (product) search.set('product', product);
  return request(`${PROMO_UPLIFTS}/resolved?${search.toString()}`);
}

/**
 * PUT /api/settings/promo-uplifts/{settingId}
 *
 * Saves a typed value as a new version (source 'estimate', so it no longer
 * follows the anchor). Learned rows answer 409.
 *
 * @param {number} settingId
 * @param {{ uplift_pct: number, note?: string | null }} payload sent with `updated_by: UPDATED_BY`
 * @returns {Promise<{ changed: boolean, setting: object }>}
 */
export async function savePromoUplift(settingId, payload) {
  return request(`${PROMO_UPLIFTS}/${encodeURIComponent(settingId)}`, {
    method: 'PUT',
    body: { ...payload, updated_by: UPDATED_BY },
  });
}

/**
 * POST /api/settings/promo-uplifts/{settingId}/reset
 *
 * An all-customers row goes back on the placeholder rule; a customer, range
 * or SKU override is retired (`setting` is then null).
 *
 * @param {number} settingId
 * @returns {Promise<{ changed: boolean, setting: object | null }>}
 */
export async function resetPromoUplift(settingId) {
  return request(`${PROMO_UPLIFTS}/${encodeURIComponent(settingId)}/reset`, {
    method: 'POST',
    body: { updated_by: UPDATED_BY },
  });
}

/**
 * POST /api/settings/promo-uplifts
 *
 * A mechanic's own value for one customer, SKU range or SKU. 409 when that
 * scope already has a value.
 *
 * @param {{ mechanic_key: string, scope: 'customer' | 'range' | 'sku', customer_id: number, sku_range?: string, sku?: string, uplift_pct: number, note?: string }} payload
 * @returns {Promise<{ changed: boolean, setting: object }>}
 */
export async function addPromoUpliftOverride(payload) {
  return request(PROMO_UPLIFTS, {
    method: 'POST',
    body: { ...payload, updated_by: UPDATED_BY },
  });
}

/**
 * GET /api/settings/promo-uplifts/mechanics/{mechanicKey}/history
 *
 * @param {string} mechanicKey
 * @returns {Promise<object[]>} every version at every scope, newest first
 */
export async function getPromoUpliftHistory(mechanicKey) {
  return request(`${PROMO_UPLIFTS}/mechanics/${encodeURIComponent(mechanicKey)}/history`);
}

/**
 * GET /api/settings/promo-uplifts/anchors
 *
 * Every customer's ordinary-month discount: the value in use, its source
 * ('manual', 'suggested' or 'default'), and the suggestion from data with the
 * months it used.
 *
 * @returns {Promise<{ default_anchor_pct: number, customers: object[] }>}
 */
export async function getPromoAnchors() {
  return request(`${PROMO_UPLIFTS}/anchors`);
}

/**
 * PUT /api/settings/promo-uplifts/anchors/{customerId}, or .../anchors/default
 * when customerId is null (the all-customers value).
 *
 * @param {number | null} customerId
 * @param {number} anchorPct 0-100
 * @returns {Promise<{ changed: boolean, anchor?: object, default_anchor_pct?: number }>}
 */
export async function savePromoAnchor(customerId, anchorPct) {
  const target = customerId == null ? 'default' : encodeURIComponent(customerId);
  return request(`${PROMO_UPLIFTS}/anchors/${target}`, {
    method: 'PUT',
    body: { anchor_pct: anchorPct, updated_by: UPDATED_BY },
  });
}

/**
 * POST /api/settings/promo-uplifts/anchors/{customerId}/reset
 *
 * Back to the suggestion from the customer's own promotions.
 *
 * @param {number} customerId
 * @returns {Promise<{ changed: boolean, anchor: object }>}
 */
export async function resetPromoAnchor(customerId) {
  return request(`${PROMO_UPLIFTS}/anchors/${encodeURIComponent(customerId)}/reset`, {
    method: 'POST',
    body: { updated_by: UPDATED_BY },
  });
}

/**
 * GET /api/settings/promo-uplifts/anchors/{customerId}/history
 *
 * @param {number} customerId
 * @returns {Promise<Array<{ id: number, anchor_pct: number | null, source: string, changed_by: string, changed_at: string, is_current: boolean }>>}
 */
export async function getPromoAnchorHistory(customerId) {
  return request(`${PROMO_UPLIFTS}/anchors/${encodeURIComponent(customerId)}/history`);
}
