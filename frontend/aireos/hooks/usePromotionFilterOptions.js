'use client';

import { useEffect, useState } from 'react';
import { getPromotionFilterOptions } from '@/app/services/promotionsApi';

const NO_OPTIONS = { retailers: [], stores: [], periods: [], types: [], mechanics: [] };

/**
 * The promotion overview's filter dropdown values
 * (promotionsApi getPromotionFilterOptions), from every promotion rather
 * than the page on screen. Refetches when `refreshKey` changes, so a saved
 * promotion's new store or mechanic becomes a choice.
 *
 * `data` is empty lists until the first answer, so the filter bar renders
 * straight away.
 *
 * @param {{ refreshKey?: string | number }} [options]
 */
export default function usePromotionFilterOptions({ refreshKey = 0 } = {}) {
  const [data, setData] = useState(NO_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      try {
        setLoading(true);
        const options = await getPromotionFilterOptions();
        if (!cancelled) {
          setData({ ...NO_OPTIONS, ...options });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { data, loading, error };
}
