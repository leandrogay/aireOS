import { request } from '@/app/services/promotionsApi';

// ============================================================
// Scenario builder promotions: /api/scenario/promotions
// (backend app/routers/scenario/promotions.py, table scenario_promotions,
// migration 018_create_scenario_promotions.sql)
//
// Bodies come from buildScenarioPromotionPayload and rows are read back
// with scenarioPromotionFromApi (app/utils/scenarioPromotions.js). Saving
// a promotion never changes the Current forecast, the real promotions
// table or the promo anchors; only the Scenario builder reads them.
// ============================================================

const BASE_PATH = '/api/scenario/promotions';

/**
 * GET /api/scenario/promotions?plan=&year=
 *
 * Every saved Scenario promotion, newest first.
 *
 * @returns {Promise<Array<{ promotion_id: number, customer_name: string, sku_ranges: string[] | null, sku: string | null, product_name: string | null, promo_type: string, mechanic_key: string, mechanic_label: string, reference_uplift_pct: number, reference_source: string, reference_by_sku: Record<string, number>, override_uplift_pct: number | null, voucher: boolean, voucher_uplift_pct: number, voucher_by_sku: Record<string, number>, explanation: string | null, start_month: string, end_month: string, start_date: string | null, end_date: string | null, is_active: boolean, created_at: string, updated_at: string }>>}
 */
export async function getScenarioPromotions(plan = 'scenario', year = null) {
  // Budget planning reads one year's entries at a time.
  const params = new URLSearchParams({ plan });
  if (year) params.set('year', year);
  return request(`${BASE_PATH}?${params}`);
}

/**
 * POST /api/scenario/promotions
 *
 * @param {object} payload from buildScenarioPromotionPayload
 * @returns {Promise<object>} the saved promotion, same shape as the list
 */
export async function createScenarioPromotion(payload) {
  return request(BASE_PATH, { method: 'POST', body: payload });
}

/**
 * PUT /api/scenario/promotions/{promotionId}
 *
 * Replaces every field, including is_active.
 *
 * @param {number} promotionId
 * @param {object} payload from buildScenarioPromotionPayload
 * @returns {Promise<object>} the saved promotion, same shape as the list
 */
export async function updateScenarioPromotion(promotionId, payload) {
  return request(`${BASE_PATH}/${encodeURIComponent(promotionId)}`, { method: 'PUT', body: payload });
}

/**
 * DELETE /api/scenario/promotions/{promotionId}
 *
 * @param {number} promotionId
 * @returns {Promise<{ deleted: true }>}
 */
export async function deleteScenarioPromotion(promotionId, plan = 'scenario') {
  return request(`${BASE_PATH}/${encodeURIComponent(promotionId)}?${new URLSearchParams({ plan })}`, { method: 'DELETE' });
}
