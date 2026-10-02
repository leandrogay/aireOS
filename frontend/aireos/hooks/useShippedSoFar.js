'use client';

import { useEffect, useState } from 'react';

import { getShippedSoFar } from '@/app/services/inventoryApi';

/**
 * The current temporary sell-in for one SKU and month, per customer (backend
 * inventory_service.get_shipped_so_far) -- what saving again would overwrite.
 * Does nothing until a customer, SKU and month are all chosen.
 *
 * @param {{ customerIds?: number[], sku?: string, month?: string }} [options]
 * @returns {{ data: Array<{ customer_id: number, customer_name: string, shipped_so_far: number }> | null, loading: boolean, error: string | null }}
 */
export default function useShippedSoFar({ customerIds = [], sku = '', month = '' } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerIds, sku, month });

  useEffect(() => {
    // The form only reads `data` once all three are chosen (see
    // ShippedSoFarForm), so a stale value left over from a previous
    // selection is never shown -- no need to reset it here, which would
    // just be a setState-in-effect for no visible benefit.
    const filters = JSON.parse(filterKey);
    if (!filters.customerIds.length || !filters.sku || !filters.month) return undefined;

    let cancelled = false;

    async function fetchShipped() {
      setLoading(true);
      try {
        const result = await getShippedSoFar(filters);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchShipped();
    return () => {
      cancelled = true;
    };
  }, [filterKey]);

  return { data, loading, error };
}
