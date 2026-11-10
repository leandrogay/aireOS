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
 * `customers` (the ticked ones) reads across all of them instead of `customer`.
 *
 * @param {{ customer: string, customers?: string[], store?: string, sku?: string, startDate: string, endDate: string }} filters
 * @returns {Promise<{ offline: string[], online: string[] }>} YYYY-MM-01 months, sorted
 */
export async function getMonthlyOnly({ customer, customers = [], store, sku, startDate, endDate }) {
  const params = new URLSearchParams();
  if (customers.length > 0) params.set('customers', customers.join(','));
  else params.set('customer', customer);
  if (store) params.set('store', store);
  if (sku) params.set('sku', sku);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return request(`/api/sales/monthly-only?${params.toString()}`);
}

/**
 * GET /api/sales/customer-totals
 *
 * One period total per customer, split into offline and online — see backend
 * get_customer_totals. Each bar on the cross-customer chart is this sum for
 * the selected dates. has_offline / has_online say whether that channel
 * exists for the customer at all.
 *
 * @param {{ customers: string[], sku?: string, startDate: string, endDate: string }} filters
 * @returns {Promise<{ customers: Array<{ customer: string, label: string, has_offline: boolean, has_online: boolean, offline: { revenue: number, units: number }, online: { revenue: number, units: number } }> }>}
 */
export async function getCustomerTotals({ customers, sku, startDate, endDate }) {
  const params = new URLSearchParams({ customers: customers.join(',') });
  if (sku) params.set('sku', sku);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return request(`/api/sales/customer-totals?${params.toString()}`);
}

/**
 * GET /api/sales/customer-trends
 *
 * Each ticked customer's revenue and units per week or month, split into
 * offline and online — see backend get_customer_trends. Any number of
 * customers. Every period carries estimated_revenue, the part
 * of its revenue that was filled in rather than reported.
 *
 * @param {{ customers: string[], granularity: 'week' | 'month', sku?: string, startDate: string, endDate: string }} filters
 * @returns {Promise<{ granularity: string, customers: Array<{ customer: string, label: string, has_offline: boolean, has_online: boolean, offline: Array<object>, online: Array<object> }> }>}
 */
export async function getCustomerTrends({ customers, granularity, sku, startDate, endDate }) {
  const params = new URLSearchParams({ customers: customers.join(','), granularity });
  if (sku) params.set('sku', sku);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return request(`/api/sales/customer-trends?${params.toString()}`);
}

/**
 * GET /api/sales/dashboard-summary
 *
 * One customer's figures per week or month, split by channel and store
 * format — see backend get_dashboard_summary. Read by useDashboardSummary.
 *
 * @param {{ customer: string, sku?: string, store?: string, startDate: string, endDate: string, granularity?: 'week' | 'month' }} filters
 * @returns {Promise<Record<'offline' | 'online', { storeFormats: Array<object>, periodTotal: Array<object>, periodByFormat: Array<object> }>>}
 */
export async function getDashboardSummary({ customer, sku, store, startDate, endDate, granularity = 'week' }) {
  const params = new URLSearchParams({ granularity, customer });
  if (sku) params.set('sku', sku);
  if (store) params.set('store', store);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return request(`/api/sales/dashboard-summary?${params.toString()}`);
}

/**
 * GET /api/sales/default-date-range
 *
 * The latest loaded period (and the earliest, and the latest genuine week)
 * for one customer, or across `customers` (the ticked ones) when given —
 * see backend get_default_date_range. Read by useDefaultDateRange.
 *
 * @param {{ customer?: string, customers?: string[], mode?: string, period?: string }} filters
 * @returns {Promise<{ start: string | null, end: string | null, period_type: string | null, earliest_start: string | null, latest_week_start: string | null }>}
 */
export async function getDefaultDateRange({ customer = '', customers = [], mode, period = 'month' }) {
  const params = new URLSearchParams({ period });
  if (customers.length > 0) params.set('customers', customers.join(','));
  else params.set('customer', customer);
  if (mode) params.set('mode', mode);
  return request(`/api/sales/default-date-range?${params.toString()}`);
}
