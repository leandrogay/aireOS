'use client';

import { useEffect, useState } from 'react';

import { getPromoAnchors, getPromoUpliftSettings } from '@/app/services/promoUpliftsApi';

/**
 * Everything the Promotion Uplift Settings page shows: the current uplift
 * rows with the unmapped mechanics (backend promo_uplifts.list_settings) and
 * every customer's anchor (list_anchors). `refreshKey` is bumped to refetch.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ settings: object | null, anchors: object | null, loading: boolean, error: string | null }}
 */
export default function usePromoUpliftSettings({ refreshKey = 0 } = {}) {
  const [state, setState] = useState({ settings: null, anchors: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchSettings() {
      try {
        const [settings, anchors] = await Promise.all([getPromoUpliftSettings(), getPromoAnchors()]);
        if (!cancelled) setState({ settings, anchors, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: err.message }));
      }
    }

    fetchSettings();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
