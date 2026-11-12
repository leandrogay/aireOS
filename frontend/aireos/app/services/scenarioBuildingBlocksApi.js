import { request } from '@/app/services/promotionsApi';

// ============================================================
// Scenario builder building blocks: /api/scenario/building-blocks
// (backend app/routers/scenario/building_blocks.py)
//
// Bodies come from buildScenarioBlockPayload and rows are read back with
// scenarioBlockFromApi (app/utils/scenarioBlocks.js). Saving a block never
// changes the Current forecast; the Scenario builder reads them, and the
// sell-in plan chart's building blocks overlay offers them to pick.
// ============================================================

const BASE_PATH = '/api/scenario/building-blocks';

/**
 * GET /api/scenario/building-blocks?plan=&year=
 *
 * Every saved block, newest first, growths (kind 'growth') included.
 *
 * @returns {Promise<Array<{ block_id: number, kind: 'block' | 'growth', customer_name: string, sku: string | null, product_name: string | null, name: string, explanation: string | null, uplift_mode: 'pct' | 'units', uplift_value: number, start_month: string, end_month: string, is_active: boolean, created_at: string, updated_at: string }>>}
 */
export async function getScenarioBuildingBlocks(plan = 'scenario', year = null) {
  // Budget planning reads one year's entries at a time.
  const params = new URLSearchParams({ plan });
  if (year) params.set('year', year);
  return request(`${BASE_PATH}?${params}`);
}

/**
 * POST /api/scenario/building-blocks
 *
 * @param {object} payload from buildScenarioBlockPayload
 * @returns {Promise<object>} the saved block, same shape as the list
 */
export async function createScenarioBuildingBlock(payload) {
  return request(BASE_PATH, { method: 'POST', body: payload });
}

/**
 * PUT /api/scenario/building-blocks/{blockId}
 *
 * Replaces every field, including is_active.
 *
 * @param {number} blockId
 * @param {object} payload from buildScenarioBlockPayload
 * @returns {Promise<object>} the saved block, same shape as the list
 */
export async function updateScenarioBuildingBlock(blockId, payload) {
  return request(`${BASE_PATH}/${encodeURIComponent(blockId)}`, { method: 'PUT', body: payload });
}

/**
 * DELETE /api/scenario/building-blocks/{blockId}
 *
 * @param {number} blockId
 * @returns {Promise<{ deleted: true }>}
 */
export async function deleteScenarioBuildingBlock(blockId, plan = 'scenario') {
  return request(`${BASE_PATH}/${encodeURIComponent(blockId)}?${new URLSearchParams({ plan })}`, { method: 'DELETE' });
}
