'use client';

import { useEffect, useState } from 'react';

import { getForecastOptions } from '@/app/services/forecastApi';

/**
 * Product and customer names plus the date-picker bounds for the forecast
 * filters (GET /api/forecast/options). Shared by the Forecast page and the
 * Scenario builder so both offer the same choices.
 *
 * `data` stays null until the options arrive; pages use that as their
 * "ready" signal before fetching forecast rows.
 */
export default function useForecastOptions() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const options = await getForecastOptions();
        if (cancelled) return;
        setData({
          products: options.products ?? [],
          customers: options.customers ?? [],
          bounds: { start: options.start_date ?? '', end: options.end_date ?? '' },
        });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
