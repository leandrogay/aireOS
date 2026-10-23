import { request } from '@/app/services/promotionsApi';

// Customer, retailer and SKU wrappers for backend app/routers/catalog.py.
// Retailer/store catalog reads used by Promotions stay in promotionsApi.js.

// ============================================================
// Customers: /api/catalog/customers
// ============================================================

/** GET /api/catalog/customers. */
export async function getCustomers() {
  return request('/api/catalog/customers');
}

/** POST /api/catalog/customers. */
export async function createCustomer(payload) {
  return request('/api/catalog/customers', { method: 'POST', body: payload });
}

/** PUT /api/catalog/customers/{customerId}. */
export async function updateCustomer(customerId, payload) {
  return request(`/api/catalog/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

/** DELETE /api/catalog/customers/{customerId}. */
export async function deleteCustomer(customerId) {
  return request(`/api/catalog/customers/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
  });
}

// ============================================================
// Retailers: /api/catalog/retailers
// ============================================================

/** POST /api/catalog/retailers. */
export async function createRetailer(payload) {
  return request('/api/catalog/retailers', { method: 'POST', body: payload });
}

/** PUT /api/catalog/retailers/{retailerId}. */
export async function updateRetailer(retailerId, payload) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

/** PUT /api/catalog/retailers/{retailerId}/customer. */
export async function linkRetailer(retailerId, payload) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}/customer`, {
    method: 'PUT',
    body: payload,
  });
}

/** DELETE /api/catalog/retailers/{retailerId}. */
export async function deleteRetailer(retailerId) {
  return request(`/api/catalog/retailers/${encodeURIComponent(retailerId)}`, {
    method: 'DELETE',
  });
}

// ============================================================
// SKUs: /api/catalog/skus
// ============================================================

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value != null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** GET /api/catalog/skus with optional search and filters. */
export async function getSkus(filters) {
  const data = await request(`/api/catalog/skus${queryString(filters)}`);
  return Array.isArray(data) ? data : [];
}

/** GET /api/catalog/skus/{sku}. */
export function getSku(sku) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`);
}

/** GET /api/catalog/skus/options. */
export async function getSkuOptions() {
  const data = await request('/api/catalog/skus/options');
  return data && typeof data === 'object' ? data : {};
}

/** POST /api/catalog/skus. */
export function createSku(payload) {
  return request('/api/catalog/skus', { method: 'POST', body: payload });
}

/** PUT /api/catalog/skus/{sku}. */
export function updateSku(sku, payload) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    body: payload,
  });
}

/** DELETE /api/catalog/skus/{sku}; archives rather than removing history. */
export function archiveSku(sku) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`, {
    method: 'DELETE',
  });
}
