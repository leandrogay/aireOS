'use client';

import { useEffect, useState } from 'react';

import { getSkus } from '@/app/services/catalogApi';

/**
 * The active SKU master (backend catalog_service.list_skus): one row per SKU
 * with its code, product name and range, for pickers that must name a real SKU.
 *
 * @returns {{ skus: object[], loading: boolean, error: string | null }}
 */
export default function useSkuCatalog() {
  const [state, setState] = useState({ skus: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchSkus() {
      try {
        const skus = await getSkus();
        if (!cancelled) setState({ skus, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ skus: [], loading: false, error: err.message });
      }
    }

    fetchSkus();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
