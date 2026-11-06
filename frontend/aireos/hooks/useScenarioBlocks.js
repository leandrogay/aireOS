'use client';

import { useEffect, useState } from 'react';

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
 * }}
 */
export default function useScenarioBlocks() {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const unsavedCount = blocks.filter(hasUnsavedChanges).length;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getScenarioBuildingBlocks();
        if (!cancelled) setBlocks(rows.map(scenarioBlockFromApi));
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
  }, []);

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
    const payload = buildScenarioBlockPayload(block);
    const row = block.blockId == null
      ? await createScenarioBuildingBlock(payload)
      : await updateScenarioBuildingBlock(block.blockId, payload);
    const saved = scenarioBlockFromApi(row);
    setBlocks((current) =>
      current.map((item) => (item.id === block.id ? applySavedBlock(item, block, saved) : item))
    );
  }

  async function deleteBlock(block) {
    if (block.blockId != null) await deleteScenarioBuildingBlock(block.blockId);
    setBlocks((current) => current.filter((item) => item.id !== block.id));
  }

  return { blocks, setBlocks, saveBlock, deleteBlock, unsavedCount, loading, error };
}
