import { request } from '@/app/services/promotionsApi';

/** GET /api/scenario/budgets: each year's official locked rows (or one `version` of a `year`) and version history. */
export function getBudgets({ year, version } = {}) {
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (version) params.set('version', version);
  return request(`/api/scenario/budgets?${params}`);
}

/**
 * POST /api/scenario/budgets/lock: append a complete year's frozen plan as a
 * new version, named or not. The year's first version is always official.
 */
export function lockBudget({ year, name = null, makeOfficial = true }) {
  return request('/api/scenario/budgets/lock', { method: 'POST', body: { year, name: name || null, make_official: makeOfficial } });
}

/** POST /api/scenario/budgets/official: make one version the year's Budget line on Forecast and Inventory. */
export function setOfficialBudget(year, version) {
  return request('/api/scenario/budgets/official', { method: 'POST', body: { year, version } });
}

/**
 * POST /api/scenario/budgets/start: replace the year's budget entries with a
 * copy of a locked version's (`version`), or clear them to start from the
 * Initial Yearly Forecast alone (`version` null). Locked versions never change.
 */
export function startBudget(year, version = null) {
  return request('/api/scenario/budgets/start', { method: 'POST', body: { year, version } });
}

/**
 * DELETE /api/scenario/budgets/{year}/versions/{version}: hide a locked
 * version from the app. Its units stay on record; the official version is refused (409).
 */
export function deleteBudgetVersion(year, version) {
  return request(`/api/scenario/budgets/${encodeURIComponent(year)}/versions/${encodeURIComponent(version)}`, { method: 'DELETE' });
}
