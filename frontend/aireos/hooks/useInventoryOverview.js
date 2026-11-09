'use client';

import { useEffect, useState } from 'react';

import { getInventoryOverview } from '@/app/services/inventoryApi';

/**
 * Ending stock for all customers (backend inventory_service.get_overview).
 * Filters are collapsed into one key and re-read from it inside the effect,
 * so the dependency list stays honest even when a filter is an array.
 * `refreshKey` is bumped by the page after a create/edit to refetch.
 *
 * @param {{ customerIds?: number[], skus?: string[], startMonth?: string, endMonth?: string, atRiskOnly?: boolean, refreshKey?: number }} [options]
 * @returns {{ data: { customers: object[], monthly: object[], skus: object[] } | null, loading: boolean, error: string | null }}
 */
export default function useInventoryOverview({
  customerIds = [],
  skus = [],
  startMonth = '',
  endMonth = '',
  atRiskOnly = false,
  refreshKey = 0,
} = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerIds, skus, startMonth, endMonth, atRiskOnly });

  useEffect(() => {
    let cancelled = false;
    // Aborted on a filter change or unmount, so a slow request doesn't keep
    // holding one of the browser's few connections to the API.
    const controller = new AbortController();

    async function fetchOverview() {
      setLoading(true);
      try {
        const filters = JSON.parse(filterKey);
        const result = await getInventoryOverview(filters, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOverview();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filterKey, refreshKey]);

  return { data, loading, error };
}
