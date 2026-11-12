'use client';

import { useEffect, useState } from 'react';

import { getPromoAnchors } from '@/app/services/promoUpliftsApi';

/**
 * Every customer's and SKU range's anchor with its later changes (backend
 * promo_uplifts.list_anchors), for the Scenario builder's Breakdown tab and
 * hover card. Read-only: anchors are changed on Promotion uplift settings.
 *
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function usePromoAnchors() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchAnchors() {
      try {
        const data = await getPromoAnchors();
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      }
    }

    fetchAnchors();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
