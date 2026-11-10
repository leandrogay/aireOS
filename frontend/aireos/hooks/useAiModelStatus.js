'use client';

import { useEffect, useState } from 'react';

import { getAiModelStatus } from '@/app/services/aiModelsApi';

/**
 * Whether each AI feature's model is still available (GET /api/ai-models/status),
 * for the "AI unavailable" notices. Read on mount and again whenever
 * `refreshKey` changes (the Assistant stays mounted across pages, so it passes
 * its openings and its latest error). A failed request leaves `data` null,
 * which only hides the notice: the feature's own error still says what failed.
 *
 * @param {{ refreshKey?: string | number, enabled?: boolean }} [options]
 * @returns {{ data: object | null, loading: boolean, error: string | null }}
 */
export default function useAiModelStatus({ refreshKey = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function load() {
      try {
        const status = await getAiModelStatus();
        if (!cancelled) setData(status);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, enabled]);

  return { data, loading, error };
}
