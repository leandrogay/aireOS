// ============================================================
// Backend communication for AO4-1 promotion events.
// Each exported function is annotated with its HTTP method + endpoint.
// Event name and recurrence are collected in the UI but are not sent yet —
// the current API has no columns for them.
// ============================================================

/**
 * Turn a FastAPI error body into a short string the form can show.
 *
 * FastAPI 422 validation errors return `detail` as an array of
 * `{ loc, msg }` objects. Other failures return `detail` as a string.
 *
 * @param {unknown} data
 * @param {number} [status]
 * @returns {string}
 */
export function parseApiError(data, status) {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (data && typeof data === 'object') {
    const detail = data.detail;

    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }

    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && item.msg) return String(item.msg);
          return '';
        })
        .filter(Boolean);

      if (messages.length) {
        return messages.join(' ');
      }
    }
  }

  return status ? `Request failed (${status})` : 'Request failed';
}

/**
 * Shared fetch wrapper for promotion endpoints.
 *
 * Parses JSON when possible and throws an Error carrying `{ status, data }`
 * so callers can surface the server-provided detail. Network failures
 * (backend down, missing NEXT_PUBLIC_API_URL, CORS) reach the catch
 * without a status.
 *
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<unknown>}
 */
async function request(path, { method = 'GET', body } = {}) {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

  if (!baseUrl) {
    const error = new Error(
      'NEXT_PUBLIC_API_URL is not set. Add it to frontend/aireos/.env.local.',
    );
    error.status = 0;
    throw error;
  }

  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      const error = new Error(parseApiError(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (!error.status) {
      const wrapped = new Error(
        error.message?.includes('NEXT_PUBLIC_API_URL')
          ? error.message
          : 'Unable to reach the promotions API. Check NEXT_PUBLIC_API_URL and that the backend is running.',
      );
      wrapped.status = 0;
      throw wrapped;
    }

    throw error;
  }
}

/**
 * GET /api/promotions/health/db
 *
 * Confirms the backend can reach Cloud SQL. Used as a connection check
 * on the promotions page, not as a user-facing feature.
 *
 * @returns {Promise<{ status: string, db_reachable: boolean }>}
 */
export async function checkPromotionsDb() {
  return request('/api/promotions/health/db');
}

/**
 * GET /api/promotions/retailers
 *
 * Returns every retailer currently stored, with a store_count. The
 * retailer-scope picker uses this list for "All retailers" and for
 * choosing specific retailers.
 *
 * @returns {Promise<Array<{ retailer_id: number, retailer_name: string, store_count: number }>>}
 */
export async function getRetailers() {
  const data = await request('/api/promotions/retailers');
  return Array.isArray(data) ? data : [];
}

/**
 * GET /api/promotions
 *
 * Returns every stored promotion, newest period_start first. This is the
 * overview list shown after a successful monthly create.
 *
 * @returns {Promise<object[]>}
 */
export async function getPromotions() {
  const data = await request('/api/promotions');
  return Array.isArray(data) ? data : [];
}

/**
 * GET /api/promotions/stores
 *
 * Returns stores, optionally filtered to one retailer. Used to populate
 * the store-name dropdown and to fill store_code from the selected row
 * instead of asking the staff member to type it.
 *
 * @param {number | null} [retailerId]
 * @returns {Promise<Array<{ store_id: number, store_code: string, store_name: string, retailer_id: number, retailer_name: string }>>}
 */
export async function getStores(retailerId) {
  const query =
    retailerId != null && Number(retailerId) > 0
      ? `?retailer_id=${encodeURIComponent(retailerId)}`
      : '';
  const data = await request(`/api/promotions/stores${query}`);
  return Array.isArray(data) ? data : [];
}

/**
 * POST /api/promotions
 *
 * Creates one store-level promotion. The current schema requires retailer,
 * store_name, store_code, period_start, period_end, and promo_type.
 * Optional: store_format, period_label, promotion_mechanic, voucher, skus.
 *
 * @param {object} payload
 * @returns {Promise<object>} the created promotion
 */
export async function createPromotion(payload) {
  return request('/api/promotions', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Create one promotion row per retailer × store pair.
 *
 * The backend stores each promotion against a single retailer and store,
 * and get-or-creates the store under that retailer. Multi-select therefore
 * expands into one POST /api/promotions per pair. Recurrence is not sent.
 *
 * Does not stop on the first failure: remaining pairs are still attempted
 * so a single constraint error does not drop the whole batch.
 *
 * @param {object} sharedPayload fields shared across rows, without retailer/store
 * @param {string[]} retailerNames
 * @param {Array<{ store_name: string, store_code: string }>} stores
 * @returns {Promise<{ created: object[], failed: { retailer: string, store: string, error: string }[] }>}
 */
export async function createPromotionsForRetailersAndStores(
  sharedPayload,
  retailerNames,
  stores,
) {
  const created = [];
  const failed = [];

  for (const retailer of retailerNames) {
    for (const store of stores) {
      try {
        const promotion = await createPromotion({
          ...sharedPayload,
          retailer,
          store_name: store.store_name,
          store_code: String(store.store_code),
        });
        created.push(promotion);
      } catch (error) {
        failed.push({
          retailer,
          store: store.store_name,
          error: error.message || 'Failed to create promotion',
        });
      }
    }
  }

  return { created, failed };
}
