'use client';

import { useEffect, useState } from 'react';

import { getCustomerTrends } from '@/app/services/salesApi';

/**
 * Each ticked customer per week or month — see get_customer_trends. The chart
 * reads this while two or more customers are ticked (`enabled`); the summary
 * tiles and the customer ranking keep their period totals (useCustomerTotals).
 *
 * @param {{ dataVersion?: number, customers?: string[], granularity?: 'week' | 'month', sku?: string, startDate?: string, endDate?: string, enabled?: boolean }} options
 * @returns {{ rows: Array<object>, loading: boolean, error: string | null }}
 */
export default function useCustomerTrends({
  dataVersion = 0,
  customers = [],
  granularity = 'month',
  sku = '',
  startDate = '',
  endDate = '',
  enabled = true,
}) {
  const [rows, setRows] = useState([]);
  const [fetchedKey, setFetchedKey] = useState('');
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customers, granularity, sku, startDate, endDate });
  const canFetch = enabled && customers.length > 0 && Boolean(startDate && endDate);
  // True from the render the filters change, so the chart doesn't draw the
  // previous filters' bars under the new labels.
  const loading = canFetch && fetchedKey !== filterKey;

  useEffect(() => {
    if (!canFetch) return undefined;

    let cancelled = false;
    // Read the filters back from filterKey: callers build `customers` fresh
    // each render, so depending on the array itself refetched after every
    // response, forever.
    const filters = JSON.parse(filterKey);

    async function fetchTrends() {
      try {
        const data = await getCustomerTrends(filters);
        if (cancelled) return;
        setRows(data.customers ?? []);
        setFetchedKey(filterKey);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setFetchedKey(filterKey);
        }
      }
    }

    fetchTrends();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, filterKey, canFetch]);

  return { rows, loading, error };
}
