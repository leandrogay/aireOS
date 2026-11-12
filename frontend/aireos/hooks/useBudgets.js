'use client';

import { useEffect, useState } from 'react';
import { getBudgets } from '@/app/services/budgetsApi';

/** Latest locked Budget rows and history; refresh after a new lock. */
export default function useBudgets({ year } = {}) {
  const [data, setData] = useState({ rows: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await getBudgets({ year });
        if (!cancelled) { setData(result); setError(result.setup_required ? result.message : null); }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, revision]);
  return { data, loading, error, refresh: () => setRevision((value) => value + 1) };
}
