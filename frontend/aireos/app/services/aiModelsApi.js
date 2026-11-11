import { request } from '@/app/services/promotionsApi';

/**
 * GET /api/ai-models/status
 *
 * Whether each AI feature's Gemini model is still available (backend
 * ai_models.model_status). A model is unavailable from the first call that
 * came back "not found" until its setting names a different model; `message`
 * says which setting to change. The backend never errors on this read.
 *
 * @returns {Promise<Record<'mapping' | 'assistant', { model: string, available: boolean, message: string | null }>>}
 */
export async function getAiModelStatus() {
  return request('/api/ai-models/status');
}
