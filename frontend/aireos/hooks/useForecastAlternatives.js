'use client';

import { useEffect, useState } from 'react';

import { getForecastAlternatives } from '@/app/services/forecastApi';

/**
 * The forecast without the model's promotions, for the Scenario builder's
 * "Simulate New Promotions" view (backend /api/forecast/alternatives). Only
 * fetched when `enabled` (the loaded rows have months whose Current line
 * already includes an entered promotion). Fetched for every month of the
 * customer/SKU, not just the chart's dates, so the year totals can use it too.
 *
 * @param {{ enabled: boolean, productName?: string, customerName?: string }} options
 * @returns {{ data: object[], loading: boolean, error: string | null }}
 */
export default function useForecastAlternatives({ enabled, productName = '', customerName = '' }) {
  const [state, setState] = useState({ key: '', data: [], loading: false, error: null });
  const key = JSON.stringify({ productName, customerName });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function fetchAlternatives() {
      setState((current) => ({ ...current, loading: true }));
      try {
        const data = await getForecastAlternatives({ productName, customerName });
        if (!cancelled) setState({ key, data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ key, data: [], loading: false, error: err.message });
      }
    }

    fetchAlternatives();
    return () => {
      cancelled = true;
    };
  }, [enabled, key, productName, customerName]);

  // A payload for a previous filter is never applied to the new one.
  const fresh = state.key === key;
  return {
    data: enabled && fresh ? state.data : [],
    loading: enabled && (state.loading || !fresh),
    error: enabled && fresh ? state.error : null,
  };
}
