'use client';

import { useEffect, useState } from 'react';

import { getResolvedPromoUplifts } from '@/app/services/promoUpliftsApi';

/**
 * Promotion uplifts for the Scenario builder's Promotions tab, one resolved
 * set per customer (backend settings/promo_uplifts.resolve_uplifts, all
 * SKUs; per-product values come back in `product_uplifts`). Loading every
 * customer up front lets the form switch customer without waiting.
 * `refreshKey` is bumped to refetch.
 *
 * @param {{ customers?: string[], refreshKey?: number }} options forecast customer names
 * @returns {{ data: Record<string, object>, loading: boolean, error: string | null }}
 */
export default function usePromoUplifts({ customers = [], refreshKey = 0 } = {}) {
  const [state, setState] = useState({ data: {}, loading: true, error: null });
  const customersKey = JSON.stringify(customers);

  useEffect(() => {
    let cancelled = false;
    const names = JSON.parse(customersKey);

    async function fetchUplifts() {
      try {
        const results = await Promise.all(names.map((customer) => getResolvedPromoUplifts({ customer })));
        if (cancelled) return;
        setState({
          data: Object.fromEntries(names.map((name, index) => [name, results[index]])),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!cancelled) setState({ data: {}, loading: false, error: err.message });
      }
    }

    fetchUplifts();
    return () => {
      cancelled = true;
    };
  }, [customersKey, refreshKey]);

  return state;
}
