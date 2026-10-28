'use client';

import { useEffect, useState } from 'react';

import { getCustomers, getSkus } from '@/app/services/catalogApi';

/**
 * The Customer and SKU filter options on Promotion uplift settings, read
 * from the catalogue (backend customer_service.list_customers and
 * catalog_service.get_skus) rather than from the uplift rows, so a customer
 * or SKU added on the Customers or SKUs page shows up here on the next load
 * or Refresh. `refreshKey` is bumped to refetch.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ customers: object[], skus: object[], loading: boolean, error: string | null }}
 */
export default function usePromoUpliftFilterOptions({ refreshKey = 0 } = {}) {
  const [state, setState] = useState({ customers: [], skus: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      try {
        const [customerResult, skus] = await Promise.all([getCustomers(), getSkus()]);
        if (!cancelled) setState({ customers: customerResult.customers, skus, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: err.message }));
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
