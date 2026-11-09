'use client';

import { useEffect, useState } from 'react';

import { getSellInOutlook } from '@/app/services/inventoryApi';

/**
 * Sell-in and sell-out by month for the sell-in plan chart (backend
 * inventory_service.get_sell_in_outlook). Does nothing until a customer is
 * chosen. `refreshKey` is bumped after a create/edit, since that moves actuals.
 * `startYear` null lets the backend pick its default (the current year).
 * `blockIds` are the building blocks overlay's picks (getSellInOutlook).
 *
 * @param {{ customerId?: number | null, months?: number, skus?: string[], startYear?: number | null, blockIds?: number[], refreshKey?: number }} [options]
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function useSellInOutlook({
  customerId = null,
  months = 6,
  skus = [],
  startYear = null,
  blockIds = [],
  refreshKey = 0,
} = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerId, months, skus, startYear, blockIds });

  useEffect(() => {
    const { customerId: id, ...filters } = JSON.parse(filterKey);
    if (!id) return undefined;

    let cancelled = false;
    // Aborted on a filter change or unmount, so a slow request doesn't keep
    // holding one of the browser's few connections to the API.
    const controller = new AbortController();

    async function fetchOutlook() {
      setLoading(true);
      try {
        const result = await getSellInOutlook(id, filters, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOutlook();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filterKey, refreshKey]);

  return { data, loading, error };
}
