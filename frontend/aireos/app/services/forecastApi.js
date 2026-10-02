function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
}

async function request(path) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not set. Add it to frontend/aireos/.env.frontend.');
  }

  const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
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
  latest_sales_loaded_at: null,
};

/**
 * GET /api/forecast
 * Forecast rows from aire_forecasting_output (one per customer x SKU x month,
 * with forecast_initial / forecast_previous / forecast_current, the model per
 * month, and *_revenue at realised price), monthly actuals (cartons +
 * revenue), overlapping Postgres promos, and freshness stamps (when each
 * forecast line was generated + sales loaded_at).
 * See backend forecast_service.get_forecast_view.
 */
export async function getForecastView({
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
} = {}) {
  const params = new URLSearchParams();
  if (productName) params.set('product_name', productName);
  if (customerName) params.set('customer_name', customerName);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const query = params.toString();
  const data = await request(`/api/forecast/${query ? `?${query}` : ''}`);
  return {
    rows: data.rows ?? [],
    actuals: data.actuals ?? [],
    promotions: data.promotions ?? [],
    freshness: data.freshness ?? EMPTY_FORECAST_FRESHNESS,
  };
}
