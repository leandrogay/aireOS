'use client';

import { useEffect, useState } from 'react';

import { getForecastMissingMonths } from '@/app/services/forecastApi';

/**
 * Every customer's months with no sales file, for the help panel's "Missing
 * months" section (GET /api/forecast/missing-months). Read each time the
 * panel opens (`enabled`), so it reflects the files sent since, and never
 * while it's closed. A failed request, like the backend's own failed read,
 * leaves `available` false so the panel can say the list didn't load.
 *
 * @param {{ enabled: boolean }} options
 * @returns {{ data: { customers: object[], available: boolean }, loading: boolean, error: string | null }}
 */
export default function useForecastMissingMonths({ enabled }) {
  const [data, setData] = useState({ customers: [], available: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getForecastMissingMonths();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setData({ customers: [], available: false });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, loading, error };
}
