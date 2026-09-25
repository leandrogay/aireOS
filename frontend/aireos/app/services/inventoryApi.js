import { request } from '@/app/services/promotionsApi';

/**
 * Builds a query string, skipping empty values and repeating array keys
 * (`sku=A&sku=B`), which is how FastAPI reads `list[str]` query params.
 *
 * @param {Record<string, string | number | Array<string | number> | null | undefined>} params
 * @returns {string} '' or '?a=1&b=2'
 */
function toQuery(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else if (value !== '' && value !== null && value !== undefined) {
      search.append(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * GET /api/inventory/customers
 *
 * @returns {Promise<Array<{ customer_id: number, customer_name: string }>>}
 */
export async function getInventoryCustomers() {
  return request('/api/inventory/customers');
}

/**
 * GET /api/inventory/skus
 *
 * Catalog SKUs (not only ones that already have inventory), so a new SKU can
 * be entered.
 *
 * @returns {Promise<Array<{ sku: string, product_name: string, sku_range: string | null, size: string | null }>>}
 */
export async function getInventorySkus() {
  return request('/api/inventory/skus');
}

/**
 * GET /api/inventory/overview
 *
 * Ending stock for every customer: `monthly` (one row per customer and
 * month, for the bar chart) and `skus` (one row per customer, SKU and
 * month, for the table). Months are 'YYYY-MM-01' strings.
 *
 * `atRiskOnly` keeps only the SKUs that are on the at-risk list now.
 *
 * @param {{ customerIds?: number[], skus?: string[], startMonth?: string, endMonth?: string, atRiskOnly?: boolean }} [filters]
 * @returns {Promise<{ customers: object[], monthly: object[], skus: object[] }>}
 */
export async function getInventoryOverview({ customerIds, skus, startMonth, endMonth, atRiskOnly } = {}) {
  return request(
    `/api/inventory/overview${toQuery({
      customer_id: customerIds,
      sku: skus,
      start_month: startMonth,
      end_month: endMonth,
      at_risk_only: atRiskOnly ? 'true' : '',
    })}`,
  );
}

/**
 * GET /api/inventory/at-risk
 *
 * Every SKU whose days of holding is outside its customer's min-max band in the
 * latest month of actuals, across all customers by default, most severe first.
 * `counts` always covers both kinds; `risk` narrows `items`.
 *
 * @param {{ customerIds?: number[], risk?: 'below_min' | 'above_max' | '' }} [filters]
 * @returns {Promise<{ as_of: string | null, counts: { below_min: number, above_max: number }, items: object[] }>}
 */
export async function getAtRisk({ customerIds, risk } = {}) {
  return request(`/api/inventory/at-risk${toQuery({ customer_id: customerIds, risk })}`);
}

/**
 * GET /api/inventory/customers/{customerId}
 *
 * One customer's stock with DOH: `trend` (per month), `skus` (per SKU and
 * month, with target and gap) and the customer's current `threshold`.
 *
 * @param {number} customerId
 * @param {{ skus?: string[], startMonth?: string, endMonth?: string }} [filters]
 * @returns {Promise<{ customer: object, threshold: object, trend: object[], skus: object[] }>}
 */
export async function getCustomerInventory(customerId, { skus, startMonth, endMonth } = {}) {
  return request(
    `/api/inventory/customers/${encodeURIComponent(customerId)}${toQuery({
      sku: skus,
      start_month: startMonth,
      end_month: endMonth,
    })}`,
  );
}

/**
 * GET /api/inventory/customers/{customerId}/sell-in-plan
 *
 * Recommended sell-in per SKU and future month, from the forecast and the
 * customer's target DOH: `rows` (SKU x month), `monthly_totals`, `sku_totals`
 * (what to order, by item) and `skus_without_forecast`.
 *
 * @param {number} customerId
 * @param {{ months?: number, skus?: string[] }} [options] how many months ahead, 1 to 12 (default 6), and the SKUs to plan (default all)
 * @returns {Promise<{ customer: object, threshold: object, actuals_through: string | null, rows: object[], monthly_totals: object[], sku_totals: object[], skus_without_forecast: object[] }>}
 */
export async function getSellInPlan(customerId, { months, skus } = {}) {
  return request(
    `/api/inventory/customers/${encodeURIComponent(customerId)}/sell-in-plan${toQuery({ months, sku: skus })}`,
  );
}

/**
 * POST /api/inventory/records
 *
 * Creates one month of inventory data for one SKU across the chosen
 * customers. 409 when the month already has data.
 *
 * @param {object} payload see buildInventoryPayload in app/utils/inventoryForm.js
 * @returns {Promise<{ customer_ids: number[], sku: string, month: string, records_written: number }>}
 */
export async function createInventoryRecord(payload) {
  return request('/api/inventory/records', { method: 'POST', body: payload });
}

/**
 * PUT /api/inventory/records
 *
 * Replaces the quantities of an existing month. 404 when it has no data.
 *
 * @param {object} payload see buildInventoryPayload in app/utils/inventoryForm.js
 * @returns {Promise<{ customer_ids: number[], sku: string, month: string, records_written: number }>}
 */
export async function updateInventoryRecord(payload) {
  return request('/api/inventory/records', { method: 'PUT', body: payload });
}

/**
 * PUT /api/inventory/shipped-so-far
 *
 * Sell-in already sent for a month that has not ended, per SKU. Used only by
 * the sell-in plan (it is taken off the recommended sell-in); the finished
 * month's real totals go through createInventoryRecord. Saving again replaces
 * the earlier figure. 400 when the month already has actual data.
 *
 * @param {{ customer_ids: number[], sku: string, month: string, shipped_so_far: number }} payload
 * @returns {Promise<{ customer_ids: number[], sku: string, month: string, shipped_so_far: number, records_written: number }>}
 */
export async function setShippedSoFar(payload) {
  return request('/api/inventory/shipped-so-far', { method: 'PUT', body: payload });
}

/**
 * GET /api/inventory/doh-thresholds
 *
 * @returns {Promise<Array<{ customer_id: number, customer_name: string, min_doh: number, target_doh: number, max_doh: number, is_global_default: boolean, last_updated: string | null }>>}
 */
export async function getDohThresholds() {
  return request('/api/inventory/doh-thresholds');
}

/**
 * PUT /api/inventory/doh-thresholds
 *
 * @param {{ customer_ids: number[], target_doh: number }} payload
 * @returns {Promise<object[]>} the updated thresholds
 */
export async function setDohThresholds(payload) {
  return request('/api/inventory/doh-thresholds', { method: 'PUT', body: payload });
}

/**
 * DELETE /api/inventory/doh-thresholds/{customerId}
 *
 * Drops the customer's own target so the global default applies again.
 *
 * @param {number} customerId
 * @returns {Promise<object>} the customer's threshold after the reset
 */
export async function resetDohThreshold(customerId) {
  return request(`/api/inventory/doh-thresholds/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/inventory/doh-thresholds/{customerId}/history
 *
 * Every target the customer has had, newest first, each with the value it
 * replaced.
 *
 * @param {number} customerId
 * @returns {Promise<object[]>}
 */
export async function getDohHistory(customerId) {
  return request(`/api/inventory/doh-thresholds/${encodeURIComponent(customerId)}/history`);
}
