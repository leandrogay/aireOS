'use client';

import { useEffect, useState } from 'react';

import { getCustomerInventory } from '@/app/services/inventoryApi';

/**
 * One customer's stock with DOH (backend inventory_service.get_customer_view).
 * Does nothing until a customer is chosen. `refreshKey` is bumped by the page
 * after a create/edit to refetch.
 *
 * @param {{ customerId?: number | null, skus?: string[], startMonth?: string, endMonth?: string, refreshKey?: number }} [options]
 * @returns {{ data: { customer: object, threshold: object, trend: object[], skus: object[] } | null, loading: boolean, error: string | null }}
 */
export default function useCustomerInventory({
  customerId = null,
  skus = [],
  startMonth = '',
  endMonth = '',
  refreshKey = 0,
} = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ customerId, skus, startMonth, endMonth });

  useEffect(() => {
    const { customerId: id, ...filters } = JSON.parse(filterKey);
    if (!id) return undefined;

    let cancelled = false;
    // Aborted on a filter change or unmount, so a slow request doesn't keep
    // holding one of the browser's few connections to the API.
    const controller = new AbortController();

    async function fetchCustomer() {
      setLoading(true);
      try {
        const result = await getCustomerInventory(id, filters, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCustomer();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filterKey, refreshKey]);

  return { data, loading, error };
}
