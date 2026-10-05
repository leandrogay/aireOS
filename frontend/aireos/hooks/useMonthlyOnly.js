'use client';

import { useEffect, useState } from 'react';
import { getMonthlyOnly } from '@/app/services/salesApi';

/**
 * The months in a date range with monthly-only sales data, per channel
 * (salesApi getMonthlyOnly): `data` is { offline: string[], online: string[] }.
 * The dashboard reads it before picking the chart granularity, so it can't
 * come from dashboard-summary itself, and names the months in its "no
 * weekly data" message.
 *
 * Months are kept with the filters they were fetched for and only returned
 * while those filters still apply, so a new range reports `loading` instead
 * of the previous range's months. dataVersion refetches without that
 * loading state (the filters didn't change).
 */
export default function useMonthlyOnly({
  dataVersion = 0,
  customer = '',
  store = '',
  sku = '',
  startDate = '',
  endDate = '',
  enabled = true,
}) {
  const [result, setResult] = useState({ key: '', flags: null, error: null });
  const active = enabled && Boolean(customer && startDate && endDate);
  const key = JSON.stringify({ customer, store, sku, startDate, endDate });

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;

    async function fetchFlags() {
      try {
        const flags = await getMonthlyOnly({ customer, store, sku, startDate, endDate });
        if (!cancelled) setResult({ key, flags, error: null });
      } catch (err) {
        if (!cancelled) setResult({ key, flags: null, error: err.message });
      }
    }

    fetchFlags();
    return () => {
      cancelled = true;
    };
  }, [active, key, dataVersion, customer, store, sku, startDate, endDate]);

  const current = active && result.key === key;
  return {
    data: current ? result.flags : null,
    loading: active && !current,
    error: current ? result.error : null,
  };
}
