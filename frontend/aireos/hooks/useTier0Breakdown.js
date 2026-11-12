'use client';

import { useEffect, useState } from 'react';

import { getTier0Breakdown } from '@/app/services/scenarioTier0BreakdownApi';

/**
 * Tier 0 split into its baseline and the promotions it carries, for the
 * customer and SKU range in view (backend scenario/tier0_breakdown), read
 * again when either changes.
 *
 * @param {{ ready: boolean, customerName: string, skuRange: string }} options
 * @returns {{ data: { rows: object[] } | null, loading: boolean, error: string | null }}
 */
export default function useTier0Breakdown({ ready, customerName, skuRange }) {
  const [state, setState] = useState({ data: null, loading: true, error: null, key: null });
  const key = JSON.stringify({ customerName, skuRange });

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    async function fetchBreakdown() {
      try {
        const data = await getTier0Breakdown({ customerName, skuRange });
        if (!cancelled) setState({ data, loading: false, error: null, key });
      } catch (err) {
        if (!cancelled) setState({ data: null, loading: false, error: err.message, key });
      }
    }

    fetchBreakdown();
    return () => {
      cancelled = true;
    };
  }, [ready, customerName, skuRange, key]);

  // A change of filters shows loading until its own answer arrives.
  if (state.key !== key) return { data: null, loading: true, error: null };
  return { data: state.data, loading: state.loading, error: state.error };
}
