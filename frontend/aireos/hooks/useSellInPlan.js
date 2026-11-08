'use client';

import { useEffect, useState } from 'react';

import { getSellInPlan } from '@/app/services/inventoryApi';

/**
 * Recommended sell-in for one customer (backend inventory_service.get_sell_in_plan).
 * Does nothing until a customer is chosen. `refreshKey` is bumped after a
 * create/edit, since that moves the plan.
 *
 * @param {{ customerId?: number | null, months?: number, skus?: string[], refreshKey?: number }} [options]
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function useSellInPlan({ customerId = null, months = 6, skus = [], refreshKey = 0 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerId, months, skus });

  useEffect(() => {
    const { customerId: id, ...filters } = JSON.parse(filterKey);
    if (!id) return undefined;

    let cancelled = false;
    // Aborted on a filter change or unmount, so a slow request doesn't keep
    // holding one of the browser's few connections to the API.
    const controller = new AbortController();

    async function fetchPlan() {
      setLoading(true);
      try {
        const result = await getSellInPlan(id, filters, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPlan();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filterKey, refreshKey]);

  return { data, loading, error };
}
