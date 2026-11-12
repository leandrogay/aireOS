'use client';

import { useEffect, useState } from 'react';

import { getInventoryCustomers } from '@/app/services/inventoryApi';

/**
 * Every customer, including those with no sales yet (backend list_customers),
 * for giving each one the same colour on every page. Refetches on dataVersion.
 * `enabled: false` holds off (the assistant, until its panel is first opened).
 *
 * @param {{ dataVersion?: number, enabled?: boolean }} [options]
 * @returns {{ customers: Array<{ customer_id: number, customer_name: string }>, loading: boolean, error: string | null }}
 */
export default function useAllCustomers({ dataVersion = 0, enabled = true } = {}) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function fetchCustomers() {
      try {
        const result = await getInventoryCustomers();
        if (!cancelled) {
          setCustomers(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCustomers();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, enabled]);

  return { customers, loading, error };
}
