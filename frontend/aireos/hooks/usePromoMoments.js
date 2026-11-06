'use client';

import { useEffect, useState } from 'react';

import { getPromoMoments } from '@/app/services/promoUpliftsApi';

/**
 * Promotion moments and Recommended Uplifts (backend
 * promo_moments.list_moments), kept apart from usePromoUpliftSettings so the
 * settings still show when sell-out can't be read. `refreshKey` is bumped to
 * refetch.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function usePromoMoments({ refreshKey = 0 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchMoments() {
      try {
        const data = await getPromoMoments();
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: err.message }));
      }
    }

    fetchMoments();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
