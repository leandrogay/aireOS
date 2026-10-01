'use client';

import { useEffect, useState } from 'react';

import { getInventoryCustomers, getInventorySkus } from '@/app/services/inventoryApi';

/**
 * Customers and catalog SKUs for the inventory filters and forms (backend
 * inventory_service.list_customers / list_skus). Loaded once per page.
 *
 * @returns {{ customers: Array<{ customer_id: number, customer_name: string }>, skus: Array<{ sku: string, product_name: string, sku_range: string | null, size: string | null }>, loading: boolean, error: string | null }}
 */
export default function useInventoryOptions() {
  const [customers, setCustomers] = useState([]);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      try {
        const [customerRows, skuRows] = await Promise.all([getInventoryCustomers(), getInventorySkus()]);
        if (cancelled) return;
        setCustomers(customerRows);
        setSkus(skuRows);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  return { customers, skus, loading, error };
}
