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

export async function getForecastOptions() {
  return request('/api/forecast/options');
}

/**
 * GET /api/forecast
 * Model rows for the selected tier (no fallback), monthly actuals (cartons),
 * overlapping Postgres promos, and freshness stamps (forecast_generated_at
 * per tier + sales loaded_at).
 */
export async function getForecastView({
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
  tier,
} = {}) {
  const params = new URLSearchParams();
  if (productName) params.set('product_name', productName);
  if (customerName) params.set('customer_name', customerName);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (tier === 0 || tier === 1) params.set('tier', String(tier));
  const query = params.toString();
  const data = await request(`/api/forecast/${query ? `?${query}` : ''}`);
  return {
    rows: data.rows ?? [],
    actuals: data.actuals ?? [],
    promotions: data.promotions ?? [],
    freshness: data.freshness ?? {
      forecast_by_tier: {},
      latest_sales_loaded_at: null,
    },
  };
}
