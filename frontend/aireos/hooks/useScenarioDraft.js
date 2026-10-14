'use client';

import { useEffect, useState } from 'react';

// Two draft slots, as the blueprint caps drafts at two (Part 1.1). Each
// draft holds one item list per source (scenarioSources.js), so the
// building-blocks and promotions sections each own their own slice.
const DEFAULT_DRAFTS = [
  { id: 'draft-1', name: 'Draft 1', blocks: [], promotions: [] },
  { id: 'draft-2', name: 'Draft 2', blocks: [], promotions: [] },
];

const DEFAULT_STATE = { activeId: DEFAULT_DRAFTS[0].id, drafts: DEFAULT_DRAFTS };

// First version: drafts live in this browser tab only (blueprint Part 4.3);
// server-side storage comes once open questions 3 and 5 are answered.
function readSavedState(storageKey) {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (!Array.isArray(saved?.drafts) || saved.drafts.length !== DEFAULT_DRAFTS.length) return DEFAULT_STATE;
    const drafts = saved.drafts.map((draft, index) => ({
      ...DEFAULT_DRAFTS[index],
      ...draft,
      blocks: Array.isArray(draft.blocks) ? draft.blocks : [],
      promotions: Array.isArray(draft.promotions) ? draft.promotions : [],
    }));
    const activeId = drafts.some((draft) => draft.id === saved.activeId) ? saved.activeId : drafts[0].id;
    return { activeId, drafts };
  } catch {
    return DEFAULT_STATE;
  }
}

/**
 * The Scenario builder's Forecast Drafts: which one is selected, and its
 * building blocks and draft promotions.
 *
 * Reads sessionStorage in the initial state, so the caller must not render
 * anything draft-specific before hydration has finished (ScenarioBuilder
 * waits for the forecast options to load first).
 *
 * @param {{ storageKey?: string }} [options]
 */
export default function useScenarioDraft({ storageKey = 'aire-scenario-drafts' } = {}) {
  const [state, setState] = useState(() => readSavedState(storageKey));

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage blocked (private mode): the draft still works for this visit.
    }
  }, [storageKey, state]);

  const draft = state.drafts.find((item) => item.id === state.activeId) ?? state.drafts[0];

  function updateActive(changes) {
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((item) =>
        item.id === current.activeId ? { ...item, ...changes(item) } : item
      ),
    }));
  }

  // `next` is a new list or an updater (list => list), like a setState call.
  function setItems(itemsKey, next) {
    updateActive((item) => ({
      [itemsKey]: typeof next === 'function' ? next(item[itemsKey]) : next,
    }));
  }

  return {
    drafts: state.drafts,
    draft,
    selectDraft: (id) => setState((current) => ({ ...current, activeId: id })),
    renameDraft: (name) => updateActive(() => ({ name })),
    setBlocks: (next) => setItems('blocks', next),
    setPromotions: (next) => setItems('promotions', next),
  };
}
