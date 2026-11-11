'use client';

import { useEffect, useState } from 'react';
import { getPromotionPage } from '@/app/services/promotionsApi';

// Typing in the search box would otherwise send a request per key.
const QUERY_DELAY_MS = 250;

/**
 * One page of the promotion overview (promotionsApi getPromotionPage),
 * filtered, searched, sorted and paged by the backend. Refetches when any
 * query value changes and when `refreshKey` does (a save, a delete, Refresh).
 * While a new page is read the last one stays on screen.
 *
 * `data` is the backend's `{ promotions, total, unfiltered_total, limit,
 * offset }`, or null before the first answer.
 *
 * @param {{
 *   query: Parameters<typeof getPromotionPage>[0],
 *   refreshKey?: string | number,
 * }} options
 */
export default function usePromotionPage({ query, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Every query value, so the effect re-runs on any change (the
  // useDashboardSummary pattern) instead of listing each one.
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;

    async function fetchPage() {
      try {
        setLoading(true);
        const page = await getPromotionPage(JSON.parse(queryKey));
        if (!cancelled) {
          setData(page);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(fetchPage, QUERY_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryKey, refreshKey]);

  return { data, loading, error };
}
