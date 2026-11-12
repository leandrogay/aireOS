import { request } from '@/app/services/promotionsApi';

// ============================================================
// Scenario builder Tier 0 split: /api/scenario/tier0-breakdown
// (backend app/routers/scenario/tier0_breakdown.py)
//
// Read-only. Tier 0 itself is never changed: the Scenario builder uses the
// split to show the ordinary-month baseline, the promotions Tier 0 carries
// from the months it is built from, and the official promotions planned
// (utils/scenarioTier0Split.js).
// ============================================================

const BASE_PATH = '/api/scenario/tier0-breakdown';

/**
 * GET /api/scenario/tier0-breakdown?customer_name=&sku_range=
 *
 * One row per customer x SKU x forecast month (backend tier0_split.month_split).
 *
 * @param {{ customerName?: string, skuRange?: string, basis?: 'current' | 'initial', year?: number | null }} [filters] '' = every customer / SKU range
 * @returns {Promise<{ rows: Array<{ customer_id: number, sku: string, month_year: string, latest_month: string, tier0: number, baseline: number, carried: number, base_method: string, last_year: object | null, recent: object[], carried_level: string | null, official: { planned: boolean, uplift_pct: number, promotions: object[], level: string | null, missing: string[] } }> }>}
 */
export async function getTier0Breakdown({ customerName = '', skuRange = '', basis = 'current', year = null } = {}) {
  const params = new URLSearchParams();
  if (customerName) params.set('customer_name', customerName);
  if (skuRange) params.set('sku_range', skuRange);
  if (basis !== 'current') params.set('basis', basis);
  if (year != null) params.set('year', String(year));
  const query = params.toString();
  return request(query ? `${BASE_PATH}?${query}` : BASE_PATH);
}
