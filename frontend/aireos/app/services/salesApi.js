import { request } from '@/app/services/promotionsApi';

/**
 * GET /api/sales/skus
 *
 * Units ("volume") and revenue ("value") per SKU over one date range, for
 * one customer and channel (and optionally one store or SKU) — see backend
 * get_sku_ranking. The ranking order doesn't matter to callers summing it.
 *
 * @param {{ customer: string, mode?: string, store?: string, sku?: string, startDate: string, endDate: string }} filters
 * @returns {Promise<Array<{ sku: string, product_name: string, volume: number, value: number, rank: number }>>}
 */
export async function getSkuSales({ customer, mode, store, sku, startDate, endDate }) {
  const params = new URLSearchParams({ metric: 'value', order: 'desc', customer });
  if (mode) params.set('mode', mode);
  if (store) params.set('store', store);
  if (sku) params.set('sku', sku);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  const data = await request(`/api/sales/skus?${params.toString()}`);
  return data.skus;
}

/**
 * GET /api/sales/monthly-only
 *
 * Per channel, the months in the range loaded only as a monthly total, with
 * no weekly breakdown (e.g. August 2026) — see backend
 * get_monthly_only_months. A weekly dashboard-summary misses those months.
 *
 * @param {{ customer: string, store?: string, sku?: string, startDate: string, endDate: string }} filters
 * @returns {Promise<{ offline: string[], online: string[] }>} YYYY-MM-01 months, sorted
 */
export async function getMonthlyOnly({ customer, store, sku, startDate, endDate }) {
  const params = new URLSearchParams({ customer });
  if (store) params.set('store', store);
  if (sku) params.set('sku', sku);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return request(`/api/sales/monthly-only?${params.toString()}`);
}
