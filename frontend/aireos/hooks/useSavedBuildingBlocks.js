'use client';

import { useEffect, useState } from 'react';

import { getScenarioBuildingBlocks } from '@/app/services/scenarioBuildingBlocksApi';
import { scenarioBlockFromApi } from '@/app/utils/scenarioBlocks';

/**
 * The building blocks saved in the Scenario builder, read only, for the
 * sell-in plan chart's building blocks overlay. Rows are in the Scenario
 * builder's shape (scenarioBlockFromApi). Nothing is fetched until `enabled`,
 * so the list is only read once the overlay is switched on.
 *
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ blocks: object[], loading: boolean, error: string | null }}
 */
export default function useSavedBuildingBlocks({ enabled = true } = {}) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const rows = await getScenarioBuildingBlocks();
        if (cancelled) return;
        setBlocks(rows.map(scenarioBlockFromApi));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(`Couldn't load saved building blocks: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { blocks, loading, error };
}
