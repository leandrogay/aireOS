import { request } from '@/app/services/promotionsApi';

// Wrappers for the Customers page: customers and the retailers under them
// (backend app/routers/catalog.py). getRetailers / getStores for the
// promotions form stay in promotionsApi.js.
//
// Names are sent as typed; the backend stores them as lowercase slugs
// ("Giant Online" -> giant_online, schemas.catalog.normalise_name) and
// answers 409 with a sentence for a taken name or a record already in use.

// ============================================================
// Customers: /api/catalog/customers
// ============================================================

/**
 * GET /api/catalog/customers
 *
 * Every customer with its retailers and in-use flags, plus the retailers no
 * customer owns yet (backend customer_service.list_customers).
 *
 * @returns {Promise<{
 *   customers: Array<{ customer_id: number, customer_name: string, in_use: boolean, retailers: Array<{ retailer_id: number, retailer_name: string, store_count: number, in_use: boolean }> }>,
 *   unlinked_retailers: Array<{ retailer_id: number, retailer_name: string, store_count: number, in_use: boolean }>,
 * }>}
 */
export async function getCustomers() {
  return request('/api/catalog/customers');
}

/**
 * POST /api/catalog/customers
 *
 * @param {{ customer_name: string }} payload
 * @returns {Promise<object>} the new customer row
 */
export async function createCustomer(payload) {
  return request('/api/catalog/customers', { method: 'POST', body: payload });
}

/**
 * PUT /api/catalog/customers/{customerId}
 *
 * @param {number} customerId
 * @param {{ customer_name: string }} payload
 * @returns {Promise<object>} the updated customer row
 */
export async function updateCustomer(customerId, payload) {
  return request(`/api/catalog/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * DELETE /api/catalog/customers/{customerId}
 *
 * @param {number} customerId
 * @returns {Promise<{ status: string, customer_id: number }>}
 */
export async function deleteCustomer(customerId) {
  return request(`/api/catalog/customers/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
  });
}

// ============================================================
// Retailers: /api/catalog/retailers
//
// Writes answer with the parent customer row under `customer` (null for a
// retailer no customer owns), so the page swaps that one row in place.
// ============================================================

/**
 * POST /api/catalog/retailers
 *
 * @param {{ retailer_name: string, customer_id: number }} payload
 * @returns {Promise<{ retailer: object, customer: object }>}
 */
export async function createRetailer(payload) {
  return request('/api/catalog/retailers', { method: 'POST', body: payload });
}

/**
 * PUT /api/catalog/retailers/{retailerId}
 *
 * @param {number} retailerId
 * @param {{ retailer_name: string }} payload
 * @returns {Promise<{ retailer: object, customer: object | null }>}
 */
export async function updateRetailer(retailerId, payload) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * PUT /api/catalog/retailers/{retailerId}/customer
 *
 * Links a retailer that has no customer yet.
 *
 * @param {number} retailerId
 * @param {{ customer_id: number }} payload
 * @returns {Promise<{ retailer: object, customer: object }>}
 */
export async function linkRetailer(retailerId, payload) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}/customer`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * DELETE /api/catalog/retailers/{retailerId}
 *
 * @param {number} retailerId
 * @returns {Promise<{ status: string, retailer_id: number, customer: object | null }>}
 */
export async function deleteRetailer(retailerId) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}`, {
    method: 'DELETE',
  });
}
