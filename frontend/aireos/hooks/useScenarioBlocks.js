'use client';

import { useEffect, useRef, useState } from 'react';

import {
  createScenarioBuildingBlock,
  deleteScenarioBuildingBlock,
  getScenarioBuildingBlocks,
  updateScenarioBuildingBlock,
} from '@/app/services/scenarioBuildingBlocksApi';
import {
  applySavedBlock,
  buildScenarioBlockPayload,
  hasUnsavedChanges,
  scenarioBlockFromApi,
} from '@/app/utils/scenarioBlocks';
import { mergeScenarioItems } from '@/app/utils/scenarioSavedItems';

/**
 * The Scenario builder's building blocks: the saved ones from
 * /api/scenario/building-blocks, plus any being edited.
 *
 * `setBlocks` edits the working copies (the chart follows them at once);
 * `saveBlock` and `deleteBlock` are the only calls that reach the server.
 * Both throw on failure, with the backend's reason as the message, so the
 * caller can show it next to the block.
 *
 * @returns {{
 *   blocks: object[],
 *   setBlocks: (next: object[] | ((blocks: object[]) => object[])) => void,
 *   saveBlock: (block: object) => Promise<void>,
 *   deleteBlock: (block: object) => Promise<void>,
 *   unsavedCount: number,
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => void,
 * }}
 */
export default function useScenarioBlocks({ plan = 'scenario' } = {}) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requests = useRef({ plan, revision: 0 });
  const unsavedCount = blocks.filter(hasUnsavedChanges).length;

  useEffect(() => {
    let cancelled = false;
    if (requests.current.plan !== plan) {
      requests.current = { plan, revision: requests.current.revision + 1 };
      setBlocks([]);
    }
    const revision = requests.current.revision;

    async function load() {
      setLoading(true);
      try {
        const rows = await getScenarioBuildingBlocks(plan);
        if (!cancelled && revision === requests.current.revision) {
          setBlocks((current) => mergeScenarioItems(current, rows.map(scenarioBlockFromApi), 'blockId', hasUnsavedChanges));
          setError(null);
        }
      } catch (err) {
        if (!cancelled && revision === requests.current.revision) setError(`Couldn't load saved building blocks: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [plan, refreshKey]);

  // Warn before closing or reloading the tab while something is unsaved.
  useEffect(() => {
    if (!unsavedCount) return undefined;
    function warn(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedCount]);

  async function saveBlock(block) {
    requests.current.revision += 1;
    const payload = { ...buildScenarioBlockPayload(block), plan };
    const row = block.blockId == null
      ? await createScenarioBuildingBlock(payload)
      : await updateScenarioBuildingBlock(block.blockId, payload);
    const saved = scenarioBlockFromApi(row);
    setBlocks((current) =>
      current.map((item) => (item.id === block.id ? applySavedBlock(item, block, saved) : item))
    );
  }

  async function deleteBlock(block) {
    requests.current.revision += 1;
    if (block.blockId != null) await deleteScenarioBuildingBlock(block.blockId, plan);
    setBlocks((current) => current.filter((item) => item.id !== block.id));
  }

  return { blocks, setBlocks, saveBlock, deleteBlock, unsavedCount, loading, error, refresh: () => setRefreshKey((key) => key + 1) };
}
