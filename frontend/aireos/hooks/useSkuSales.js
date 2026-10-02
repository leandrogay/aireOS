'use client';

import { useEffect, useState } from 'react';
import { getSkuSales } from '@/app/services/salesApi';

/**
 * Units and revenue per SKU over one date range (salesApi getSkuSales), for
 * the Comparison panel's price-vs-mix split of the average-price change.
 * `enabled` skips fetching while there is no comparison. Refetches on any
 * filter change and on dataVersion, like the other dashboard hooks.
 */
export default function useSkuSales({
  dataVersion = 0,
  customer = '',
  mode = '',
  store = '',
  sku = '',
  startDate = '',
  endDate = '',
  enabled = true,
}) {
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !customer || !startDate || !endDate) return undefined;

    let cancelled = false;

    async function fetchSkus() {
      try {
        setLoading(true);
        const rows = await getSkuSales({ customer, mode, store, sku, startDate, endDate });
        if (!cancelled) {
          setSkus(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSkus();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, customer, mode, store, sku, startDate, endDate, enabled]);

  return { skus, loading, error };
}
