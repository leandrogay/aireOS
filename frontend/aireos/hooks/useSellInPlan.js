'use client';

import { useEffect, useState } from 'react';

import { getSellInPlan } from '@/app/services/inventoryApi';

/**
 * Recommended sell-in for one customer (backend inventory_service.get_sell_in_plan).
 * Does nothing until a customer is chosen. `refreshKey` is bumped after a
 * create/edit or threshold change, since both move the plan.
 *
 * @param {{ customerId?: number | null, months?: number, refreshKey?: number }} [options]
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function useSellInPlan({ customerId = null, months = 6, refreshKey = 0 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!customerId) return undefined;

    let cancelled = false;

    async function fetchPlan() {
      setLoading(true);
      try {
        const result = await getSellInPlan(customerId, { months });
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
    };
  }, [customerId, months, refreshKey]);

  return { data, loading, error };
}
