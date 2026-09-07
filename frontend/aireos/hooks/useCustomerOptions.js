'use client';

import { useEffect, useState } from 'react';

/**
 * Distinct top-level customers (retailer families, e.g. "fairprice") for the
 * page-header Customer selector — see backend get_customer_options, which
 * derives these from the retailer column rather than a hardcoded list, so a
 * newly ingested customer shows up here automatically. Refetches on
 * dataVersion so that happens without a page reload.
 */
export default function useCustomerOptions({ dataVersion = 0 } = {}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sales/customer-options`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load customer options');
        if (!cancelled) {
          setOptions(data.options);
          setError(null);
        }
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
  }, [dataVersion]);

  return { options, loading, error };
}
