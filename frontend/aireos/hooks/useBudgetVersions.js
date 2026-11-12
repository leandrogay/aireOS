'use client';

import { useEffect, useState } from 'react';
import { getBudgets } from '@/app/services/budgetsApi';

/**
 * Frozen rows of several locked versions of one year, for comparing them on
 * the Budget planning chart: { [version]: rows }.
 *
 * @param {{ year: number, versions: number[] }} options
 * @returns {{ data: Record<number, object[]>, loading: boolean, error: string | null }}
 */
export default function useBudgetVersions({ year, versions }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // One key for the list, so picking a version again doesn't refetch.
  const versionKey = [...versions].sort((a, b) => a - b).join(',');

  useEffect(() => {
    let cancelled = false;
    const wanted = versionKey ? versionKey.split(',').map(Number) : [];
    async function load() {
      if (!wanted.length) {
        setData({});
        return;
      }
      setLoading(true);
      try {
        const results = await Promise.all(wanted.map((version) => getBudgets({ year, version })));
        if (!cancelled) {
          setData(Object.fromEntries(wanted.map((version, index) => [version, results[index].rows])));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, versionKey]);

  return { data, loading, error };
}
