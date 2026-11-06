import { request } from '@/app/services/promotionsApi';

// ============================================================
// Scenario builder building blocks: /api/scenario/building-blocks
// (backend app/routers/scenario/building_blocks.py)
//
// Bodies come from buildScenarioBlockPayload and rows are read back with
// scenarioBlockFromApi (app/utils/scenarioBlocks.js). Saving a block never
// changes the Current forecast; only the Scenario builder reads them.
// ============================================================

const BASE_PATH = '/api/scenario/building-blocks';

/**
 * GET /api/scenario/building-blocks
 *
 * Every saved block, newest first.
 *
 * @returns {Promise<Array<{ block_id: number, customer_name: string, sku: string | null, product_name: string | null, name: string, explanation: string | null, uplift_mode: 'pct' | 'units', uplift_value: number, start_month: string, end_month: string, is_active: boolean, created_at: string, updated_at: string }>>}
 */
export async function getScenarioBuildingBlocks() {
  return request(BASE_PATH);
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
export async function deleteScenarioBuildingBlock(blockId) {
  return request(`${BASE_PATH}/${encodeURIComponent(blockId)}`, { method: 'DELETE' });
}
