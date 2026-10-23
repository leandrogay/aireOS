import { request } from '@/app/services/promotionsApi';

// ============================================================
// Scenario builder promotions: /api/scenario/promotions
// (backend app/routers/scenario/promotions.py)
//
// Bodies come from buildScenarioPromotionPayload and rows are read back
// with scenarioPromotionFromApi (app/utils/scenarioPromotions.js). Saving
// a promotion never changes the Current forecast or the real promotions
// table; only the Scenario builder reads them.
// ============================================================

// Go live once migration 007_create_scenario_promotions.sql has been run:
// set this to false. Until then every call below is answered in memory
// (same shapes as the backend), so Save works for the session but nothing
// survives a reload.
export const SCENARIO_PROMOTIONS_DEMO = true;

const BASE_PATH = '/api/scenario/promotions';

// ---- Demo store (only while SCENARIO_PROMOTIONS_DEMO is on) ----

let demoRows = [];
let demoNextId = 1;

function demoRow(promotionId, payload) {
  const now = new Date().toISOString();
  return { ...payload, promotion_id: promotionId, sku: null, created_at: now, updated_at: now };
}

/**
 * GET /api/scenario/promotions
 *
 * Every saved Scenario promotion, newest first.
 *
 * @returns {Promise<Array<{ promotion_id: number, customer_name: string, sku: string | null, product_name: string | null, promo_type: string, mechanic_key: string, mechanic_label: string, reference_uplift_pct: number, reference_source: string, reference_by_sku: Record<string, number>, override_uplift_pct: number | null, voucher: boolean, voucher_uplift_pct: number, voucher_by_sku: Record<string, number>, explanation: string | null, start_month: string, end_month: string, is_active: boolean, created_at: string, updated_at: string }>>}
 */
export async function getScenarioPromotions() {
  if (SCENARIO_PROMOTIONS_DEMO) return [...demoRows].reverse();
  return request(BASE_PATH);
}

/**
 * POST /api/scenario/promotions
 *
 * @param {object} payload from buildScenarioPromotionPayload
 * @returns {Promise<object>} the saved promotion, same shape as the list
 */
export async function createScenarioPromotion(payload) {
  if (SCENARIO_PROMOTIONS_DEMO) {
    const row = demoRow(demoNextId++, payload);
    demoRows = [...demoRows, row];
    return row;
  }
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
  if (SCENARIO_PROMOTIONS_DEMO) {
    const row = demoRow(promotionId, payload);
    demoRows = demoRows.map((item) => (item.promotion_id === promotionId ? row : item));
    return row;
  }
  return request(`${BASE_PATH}/${encodeURIComponent(promotionId)}`, { method: 'PUT', body: payload });
}

/**
 * DELETE /api/scenario/promotions/{promotionId}
 *
 * @param {number} promotionId
 * @returns {Promise<{ deleted: true }>}
 */
export async function deleteScenarioPromotion(promotionId) {
  if (SCENARIO_PROMOTIONS_DEMO) {
    demoRows = demoRows.filter((item) => item.promotion_id !== promotionId);
    return { deleted: true };
  }
  return request(`${BASE_PATH}/${encodeURIComponent(promotionId)}`, { method: 'DELETE' });
}
