'use client';

import { useEffect, useState } from 'react';

import { getCalculatedUplifts } from '@/app/services/promoUpliftsApi';

/**
 * The worked-out uplifts per customer x SKU range x mechanic and each
 * customer's calculation status (backend promo_uplift_calc.list_calculated),
 * kept apart from usePromoUpliftSettings so the anchors still show when the
 * calc tables can't be read. `refreshKey` is bumped to refetch.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ data: { rows: object[], calc_status: Record<string, object> } | null, loading: boolean, error: string | null }}
 */
export default function usePromoUpliftCalc({ refreshKey = 0 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchCalculated() {
      try {
        const data = await getCalculatedUplifts();
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: err.message }));
      }
    }

    fetchCalculated();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
