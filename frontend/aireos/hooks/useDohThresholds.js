'use client';

import { useEffect, useState } from 'react';

import { getDohThresholds } from '@/app/services/inventoryApi';

/**
 * Every customer's DOH threshold (backend inventory_service.get_doh_thresholds).
 * `refreshKey` is bumped after a save or reset to refetch.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ data: object[], loading: boolean, error: string | null }}
 */
export default function useDohThresholds({ refreshKey = 0 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchThresholds() {
      setLoading(true);
      try {
        const result = await getDohThresholds();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchThresholds();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { data, loading, error };
}
