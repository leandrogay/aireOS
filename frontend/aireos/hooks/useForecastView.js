'use client';

import { useEffect, useState } from 'react';

import { EMPTY_FORECAST_FRESHNESS, getForecastView } from '@/app/services/forecastApi';
import { DEFAULT_TIER } from '@/app/utils/forecastTiers';

const EMPTY_VIEW = {
  rows: [],
  tiers: [],
  availability: {},
  horizon: {},
  actuals: [],
  promotions: [],
  freshness: EMPTY_FORECAST_FRESHNESS,
};

/**
 * Forecast rows, monthly actuals, overlapping promos and freshness stamps for
 * the current filters (GET /api/forecast). Shared by the Forecast page and
 * the Scenario builder.
 *
 * The previous filter's data stays in `data` while the next one loads, so the
 * chart can show an "Updating" overlay instead of going blank.
 *
 * @param {object} options
 * @param {boolean} options.ready filter options have loaded and defaults are set
 * @param {string} options.productName SKU filter ('' = all SKUs)
 * @param {string} options.customerName customer filter ('' = all customers)
 * @param {string} options.startDate filter start, 'YYYY-MM-DD'
 * @param {string} options.endDate filter end, 'YYYY-MM-DD'
 * @param {string} [options.tier] one model's rows (Tier 0 by default), or ALL_TIERS (forecastApi.getForecastView)
 * @param {string} [options.skuRange] SKU range filter ('' = every range; the Scenario builder's)
 */
export default function useForecastView({
  ready = false,
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
  tier = DEFAULT_TIER,
  skuRange = '',
}) {
  const [data, setData] = useState(EMPTY_VIEW);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    async function loadRows() {
      setLoading(true);
      try {
        const payload = await getForecastView({ productName, customerName, startDate, endDate, tier, skuRange });
        if (cancelled) return;
        setData({
          rows: payload.rows,
          tiers: payload.tiers,
          availability: payload.availability,
          horizon: payload.horizon,
          actuals: payload.actuals,
          promotions: payload.promotions,
          freshness: payload.freshness ?? EMPTY_FORECAST_FRESHNESS,
        });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRows();
    return () => {
      cancelled = true;
    };
  }, [ready, productName, customerName, startDate, endDate, tier, skuRange]);

  return { data, loading, error };
}
