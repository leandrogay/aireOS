import { request } from './promotionsApi';

/**
 * POST /api/auth/logout
 *
 * Clears the signed AireOS browser session on the backend.
 *
 * @returns {Promise<{ status: string }>}
 */
export async function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}
