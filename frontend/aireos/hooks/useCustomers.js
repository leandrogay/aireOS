'use client';

import { useEffect, useState } from 'react';

import { getCustomers } from '@/app/services/catalogApi';

/**
 * Every customer with its retailers, plus the retailers no customer owns yet
 * (backend customer_service.list_customers). `refreshKey` is bumped to
 * refetch; the rows on screen stay while it runs.
 *
 * Writes answer with the affected customer row, so the page applies it here
 * instead of refetching: `applyCustomer` swaps it in (or adds it) and drops
 * its retailers from `unlinked` (a retailer that was just linked),
 * `removeCustomer` drops one, and `applyUnlinked` / `removeUnlinked` do the
 * same for a retailer with no customer.
 *
 * @param {{ refreshKey?: number }} [options]
 */
export default function useCustomers({ refreshKey = 0 } = {}) {
  const [data, setData] = useState([]);
  const [unlinked, setUnlinked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCustomers() {
      setLoading(true);
      try {
        const result = await getCustomers();
        if (cancelled) return;
        setData(result.customers);
        setUnlinked(result.unlinked_retailers);
        setError(null);
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
  }, [refreshKey]);

  function applyCustomer(customer) {
    setData((rows) => {
      const others = rows.filter((row) => row.customer_id !== customer.customer_id);
      return [...others, customer].sort((a, b) => a.customer_name.localeCompare(b.customer_name));
    });
    const ownIds = new Set(customer.retailers.map((retailer) => retailer.retailer_id));
    setUnlinked((rows) => rows.filter((row) => !ownIds.has(row.retailer_id)));
  }

  function removeCustomer(customerId) {
    setData((rows) => rows.filter((row) => row.customer_id !== customerId));
  }

  function applyUnlinked(retailer) {
    setUnlinked((rows) => rows.map((row) => (row.retailer_id === retailer.retailer_id ? retailer : row)));
  }

  function removeUnlinked(retailerId) {
    setUnlinked((rows) => rows.filter((row) => row.retailer_id !== retailerId));
  }

  return { data, unlinked, loading, error, applyCustomer, removeCustomer, applyUnlinked, removeUnlinked };
}
