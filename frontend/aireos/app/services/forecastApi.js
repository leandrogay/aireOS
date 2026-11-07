import { ALL_TIERS, DEFAULT_TIER, rowsForTier } from '@/app/utils/forecastTiers';

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
}

async function request(path) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not set. Add it to frontend/aireos/.env.frontend.');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

/**
 * GET /api/forecast/options
 * Product and customer names plus the date-picker bounds, across both the
 * forecast output and monthly actuals.
 */
export async function getForecastOptions() {
  return request('/api/forecast/options');
}

export const EMPTY_FORECAST_FRESHNESS = {
  current_generated_at: null,
  previous_generated_at: null,
  initial_generated_at: null,
  by_tier: {},
  latest_sales_loaded_at: null,
};

/**
 * GET /api/forecast
 * Forecast rows from aire_forecasting_output: one per customer x SKU x month
 * x tier (tier0 / tier1_basic / tier1_advanced), with forecast_initial /
 * forecast_previous / forecast_current, the month's confidence
 * (month_range_pct, month_confidence_band), the model's backtest
 * (current_backtest_smape, current_confidence_band) and *_revenue at realised
 * price; `tiers` (in tier_order) and `availability`
 * ({sku: {tier: {is_available, unavailable_reason, has_initial}}}) for the
 * Model picker; monthly actuals (cartons + revenue); overlapping Postgres
 * promos; and freshness stamps, overall and `by_tier`, plus sales loaded_at.
 * See backend forecast_service.get_forecast_view.
 *
 * `tier` keeps one model's rows: Tier 0 by default, since anything that adds
 * rows up would otherwise count each month three times. The Forecast page
 * passes ALL_TIERS so it can switch models without a new request.
 */
export async function getForecastView({
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
  tier = DEFAULT_TIER,
} = {}) {
  const params = new URLSearchParams();
  if (productName) params.set('product_name', productName);
  if (customerName) params.set('customer_name', customerName);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const query = params.toString();
  const data = await request(`/api/forecast${query ? `?${query}` : ''}`);
  const rows = data.rows ?? [];
  return {
    rows: tier === ALL_TIERS ? rows : rowsForTier(rows, tier),
    tiers: data.tiers ?? [],
    availability: data.availability ?? {},
    actuals: data.actuals ?? [],
    promotions: data.promotions ?? [],
    freshness: data.freshness ?? EMPTY_FORECAST_FRESHNESS,
  };
}

/**
 * GET /api/forecast/alternatives
 * For every customer x SKU x month whose Current line comes from the model
 * that already includes the promotion entered for that month
 * (ARIMA_PLUS_XREG), the forecast the pipeline would have picked without it:
 * alt_forecast_current (cartons), alt_low_80 / alt_high_80, their *_revenue
 * at the same realised price, and alt_source_model. Used by the Scenario
 * builder's "Simulate New Promotions" view.
 * See backend forecast_service.get_forecast_alternatives.
 */
export async function getForecastAlternatives({ productName = '', customerName = '' } = {}) {
  const params = new URLSearchParams();
  if (productName) params.set('product_name', productName);
  if (customerName) params.set('customer_name', customerName);
  const query = params.toString();
  const data = await request(`/api/forecast/alternatives${query ? `?${query}` : ''}`);
  return data.rows ?? [];
}

/**
 * GET /api/forecast/initial-status
 * One entry per Initial Yearly Forecast year in aire_forecasting_initial_meta:
 * { forecast_year, lock_at, refreshed_at, locked }. Best effort on the backend
 * (forecast_service.get_initial_status): a failed read returns no years.
 */
export async function getForecastInitialStatus() {
  const data = await request('/api/forecast/initial-status');
  return data.years ?? [];
}

/**
 * GET /api/forecast/refresh-status
 * { updating, since }: whether an event forecast refresh is waiting or
 * running (backend forecast_refresh_worker.refresh_status_best_effort).
 * Always false while event refresh is switched off.
 */
export async function getForecastRefreshStatus() {
  return request('/api/forecast/refresh-status');
}
