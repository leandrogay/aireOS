/**
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
 * Shared fetch wrapper for the backend API (promotions, catalog, inventory, and the
 * sales calls in salesApi.js).
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
export async function request(path, { method = 'GET', body, signal } = {}) {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

  if (!baseUrl) {
    const error = new Error(
      'NEXT_PUBLIC_API_URL is not set. Add it to frontend/aireos/.env.frontend.',
    );
    error.status = 0;
    throw error;
  }

  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
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
    // Cancelled by the caller (a hook whose filters changed or that unmounted):
    // not a failure, so it is passed on untouched for the caller to ignore.
    if (error.name === 'AbortError') throw error;
    if (!error.status) {
      const wrapped = new Error(
        error.message?.includes('NEXT_PUBLIC_API_URL')
          ? error.message
          : 'Unable to reach the backend API. Check NEXT_PUBLIC_API_URL and that the backend is running.',
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
 * GET /api/catalog/retailers
 *
 * Returns every retailer currently stored, with a store_count. The
 * retailer-scope picker uses this list for "All retailers" and for
 * choosing specific retailers.
 *
 * @returns {Promise<Array<{ retailer_id: number, retailer_name: string, store_count: number }>>}
 */
export async function getRetailers() {
  const data = await request('/api/catalog/retailers');
  return Array.isArray(data) ? data : [];
}

/**
 * GET /api/promotions
 *
 * One page of the promotion overview. The backend filters, searches, sorts
 * and pages (promotion_service.list_promotion_page), so they apply to every
 * promotion, not just this page; older copies of the same promotion are left
 * out. `limit` is 1-100. An `offset` past the end comes back moved to the
 * last page, and the response's `offset` is the one used. An empty filter
 * means "all".
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   search?: string,
 *   sort?: 'period_start' | 'period_end',
 *   direction?: 'asc' | 'desc',
 *   retailer?: string[],
 *   store?: string[],
 *   period?: string[],
 *   promoType?: string[],
 *   mechanic?: string[],
 *   status?: string[],
 * }} [query]
 * @returns {Promise<{ promotions: object[], total: number, unfiltered_total: number, limit: number, offset: number }>}
 */
export async function getPromotionPage(query = {}) {
  const {
    limit = 25,
    offset = 0,
    search = '',
    sort = 'period_start',
    direction = 'desc',
    retailer = '',
    store = '',
    period = '',
    promoType = '',
    mechanic = '',
    status = '',
  } = query;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sort,
    direction,
  });
  const optional = { search: search.trim(), retailer, store, period, promo_type: promoType, mechanic, status };
  for (const [key, value] of Object.entries(optional)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  }

  return request(`/api/promotions?${params}`);
}

/**
 * GET /api/promotions/filter-options
 *
 * The values the overview's filter dropdowns offer, from every listed
 * promotion (promotion_service.get_promotion_filter_options), not just the
 * page on screen.
 *
 * @returns {Promise<{ retailers: string[], stores: string[], periods: string[], types: string[], mechanics: string[] }>}
 */
export async function getPromotionFilterOptions() {
  return request('/api/promotions/filter-options');
}

/**
 * GET /api/catalog/stores
 *
 * Returns stores, optionally filtered to one retailer. Used to populate
 * the store-name dropdown and to fill store_code from the selected row
 * instead of asking the staff member to type it.
 *
 * @param {number | null} [retailerId]
 * @returns {Promise<Array<{ store_id: number, store_code: string, store_name: string, store_format: string | null, retailer_id: number, retailer_name: string }>>}
 */
export async function getStores(retailerId) {
  const query =
    retailerId != null && Number(retailerId) > 0
      ? `?retailer_id=${encodeURIComponent(retailerId)}`
      : '';
  const data = await request(`/api/catalog/stores${query}`);
  return Array.isArray(data) ? data : [];
}

/**
 * GET /api/catalog/sku-ranges
 *
 * Distinct sku_range values already stored on the skus catalog.
 * The create/edit SKU checkboxes use this list.
 *
 * @returns {Promise<string[]>}
 */
export async function getSkuRanges() {
  const data = await request('/api/catalog/sku-ranges');
  return Array.isArray(data)
    ? data.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

/**
 * POST /api/promotions
 *
 * Creates one promotion linked to every store in `stores`. The schema
 * requires stores (at least one `{ retailer, store_name, store_code }`),
 * period_start, period_end, and promo_type. Optional: period_label,
 * promotion_mechanic, voucher, skus, and store_format per store.
 * `skus` names catalog sku_range values. The backend resolves each
 * store through the catalog, writes promotion_stores, maps the SKU
 * ranges to existing skus rows, and writes promotion_skus. The
 * frontend does not insert into skus, stores, or the link tables.
 *
 * Stores already running the same event (period, type, mechanic) are left
 * out and listed in `skipped_stores`; when every store is, it fails with
 * 409 naming them (promotion_service.create_promotion).
 *
 * @param {object} payload
 * @returns {Promise<object>} the created promotion, with `stores`, `skus` and `skipped_stores`
 */
export async function createPromotion(payload) {
  return request('/api/promotions', {
    method: 'POST',
    body: payload,
  });
}

/**
 * PUT /api/promotions/{promotion_id}
 *
 * Replaces the stored promotion with the same body shape as create.
 * The backend replaces promotion_stores from `stores` and
 * promotion_skus from the ticked SKU ranges (catalog rows only), so
 * the full store list, voucher, and SKU ranges must still be sent.
 *
 * @param {number} promotionId
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function updatePromotion(promotionId, payload) {
  return request(`/api/promotions/${encodeURIComponent(promotionId)}`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * DELETE /api/promotions/{promotion_id}
 *
 * Removes the promotion row and its promotion_stores / promotion_skus
 * links. Retailer, store, and sku master data are left in place.
 *
 * @param {number} promotionId
 * @returns {Promise<{ status: string, message: string, promotion_id: number }>}
 */
export async function deletePromotion(promotionId) {
  return request(`/api/promotions/${encodeURIComponent(promotionId)}`, {
    method: 'DELETE',
  });
}
