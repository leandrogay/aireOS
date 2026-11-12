import { request } from '@/app/services/promotionsApi';

/** GET /api/scenario/budgets: latest locked rows and version history. */
export function getBudgets({ year, version } = {}) {
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (version) params.set('version', version);
  return request(`/api/scenario/budgets?${params}`);
}

/** POST /api/scenario/budgets/lock: append a complete year's frozen plan. */
export function lockBudget(year) {
  return request('/api/scenario/budgets/lock', { method: 'POST', body: { year } });
}
