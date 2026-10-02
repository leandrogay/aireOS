'use client';

import { useEffect, useState } from 'react';

import { getAtRisk } from '@/app/services/inventoryApi';

/**
 * The at-risk list (backend inventory_service.get_at_risk). Recalculated on
 * every fetch, so a SKU leaves the list once new data brings it back inside its
 * band. `refreshKey` is bumped after a create/edit.
 *
 * @param {{ customerIds?: number[], risk?: string, refreshKey?: number }} [options]
 * @returns {{ data: { as_of: string | null, counts: { below_min: number, above_max: number }, items: object[] } | null, loading: boolean, error: string | null }}
 */
export default function useAtRisk({ customerIds = [], risk = '', refreshKey = 0 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerIds, risk });

  useEffect(() => {
    let cancelled = false;

    async function fetchAtRisk() {
      setLoading(true);
      try {
        const result = await getAtRisk(JSON.parse(filterKey));
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAtRisk();
    return () => {
      cancelled = true;
    };
  }, [filterKey, refreshKey]);

  return { data, loading, error };
}
