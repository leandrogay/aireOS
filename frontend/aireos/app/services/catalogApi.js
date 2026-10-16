import { request } from '@/app/services/promotionsApi';

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value != null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function getSkus(filters) {
  const data = await request(`/api/catalog/skus${queryString(filters)}`);
  return Array.isArray(data) ? data : [];
}

export function getSku(sku) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`);
}

export async function getSkuOptions() {
  const data = await request('/api/catalog/skus/options');
  return data && typeof data === 'object' ? data : {};
}

export function createSku(payload) {
  return request('/api/catalog/skus', { method: 'POST', body: payload });
}

export function updateSku(sku, payload) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    body: payload,
  });
}

export function archiveSku(sku) {
  return request(`/api/catalog/skus/${encodeURIComponent(sku)}`, {
    method: 'DELETE',
  });
}
