'use client';

import { useEffect, useState } from 'react';
import { fetchUploadHistory } from '@/app/services/uploadApi';

// Typing in the search box would otherwise send a request per key, and each
// one lists the whole bucket (backend upload_history.list_history).
const QUERY_DELAY_MS = 250;

/**
 * One block of Recent uploads (uploadApi fetchUploadHistory), searched,
 * sorted and paged by the backend; the table pages through the block itself. Refetches when any query value changes
 * and when `refreshKey` does (an upload finished, a load, rollback or
 * delete). While a new block is read the last one stays on screen.
 *
 * `data` is the backend's `{ uploads, total, unfiltered_total, limit, offset }`,
 * or null before the first answer.
 *
 * @param {{
 *   limit: number,
 *   offset: number,
 *   search?: string,
 *   sort: 'status' | 'uploaded_at',
 *   direction: 'asc' | 'desc',
 *   refreshKey?: string | number,
 * }} options
 */
export default function useUploadHistory({
  limit,
  offset,
  search = '',
  sort,
  direction,
  refreshKey = 0,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPage() {
      try {
        setLoading(true);
        const page = await fetchUploadHistory({ limit, offset, search, sort, direction });
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
  }, [limit, offset, search, sort, direction, refreshKey]);

  return { data, loading, error };
}
