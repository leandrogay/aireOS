'use client';

import { useEffect, useState } from 'react';

import { getCustomerTotals } from '@/app/services/salesApi';

/**
 * Period totals for the ticked customers — see get_customer_totals. The chart
 * and the customer ranking share this while two or more customers are ticked
 * (`enabled`). One customer keeps the time series and the SKU ranking.
 *
 * @param {{ dataVersion?: number, customers?: string[], sku?: string, startDate?: string, endDate?: string, enabled?: boolean }} options
 * @returns {{ rows: Array<object>, loading: boolean, error: string | null }}
 */
export default function useCustomerTotals({
  dataVersion = 0,
  customers = [],
  sku = '',
  startDate = '',
  endDate = '',
  enabled = true,
}) {
  const [rows, setRows] = useState([]);
  const [fetchedKey, setFetchedKey] = useState('');
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customers, sku, startDate, endDate });
  const canFetch = enabled && customers.length > 0 && Boolean(startDate && endDate);
  // True from the render the filters change, so the chart and table don't
  // flash an empty list before the effect starts.
  const loading = canFetch && fetchedKey !== filterKey;

  useEffect(() => {
    if (!canFetch) return undefined;

    let cancelled = false;

    async function fetchTotals() {
      try {
        const data = await getCustomerTotals({ customers, sku, startDate, endDate });
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

    fetchTotals();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, filterKey, customers, sku, startDate, endDate, canFetch]);

  return { rows, loading, error };
}
