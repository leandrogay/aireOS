'use client';

import { useEffect, useRef, useState } from 'react';

import {
  createScenarioPromotion,
  deleteScenarioPromotion,
  getScenarioPromotions,
  updateScenarioPromotion,
} from '@/app/services/scenarioPromotionsApi';
import {
  applySavedPromotion,
  buildScenarioPromotionPayload,
  hasUnsavedPromotionChanges,
  scenarioPromotionFromApi,
} from '@/app/utils/scenarioPromotions';
import { mergeScenarioItems } from '@/app/utils/scenarioSavedItems';

/**
 * The Scenario builder's promotions: the saved ones from
 * /api/scenario/promotions, plus any being edited. Same contract as
 * useScenarioBlocks.
 *
 * `setPromotions` edits the working copies (the chart follows them at
 * once); `savePromotion` and `deletePromotion` are the only calls that
 * reach the server. Both throw on failure, with the backend's reason as
 * the message, so the caller can show it next to the promotion.
 *
 * @returns {{
 *   promotions: object[],
 *   setPromotions: (next: object[] | ((promotions: object[]) => object[])) => void,
 *   savePromotion: (promotion: object) => Promise<void>,
 *   deletePromotion: (promotion: object) => Promise<void>,
 *   unsavedCount: number,
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => void,
 * }}
 */
export default function useScenarioPromotions({ plan = 'scenario' } = {}) {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requests = useRef({ plan, revision: 0 });
  const unsavedCount = promotions.filter(hasUnsavedPromotionChanges).length;

  useEffect(() => {
    let cancelled = false;
    if (requests.current.plan !== plan) {
      requests.current = { plan, revision: requests.current.revision + 1 };
      setPromotions([]);
    }
    const revision = requests.current.revision;

    async function load() {
      setLoading(true);
      try {
        const rows = await getScenarioPromotions(plan);
        if (!cancelled && revision === requests.current.revision) {
          setPromotions((current) => mergeScenarioItems(current, rows.map(scenarioPromotionFromApi), 'promotionId', hasUnsavedPromotionChanges));
          setError(null);
        }
      } catch (err) {
        if (!cancelled && revision === requests.current.revision) setError(`Couldn't load saved promotions: ${err.message}`);
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

  async function savePromotion(promotion) {
    requests.current.revision += 1;
    const payload = { ...buildScenarioPromotionPayload(promotion), plan };
    const row = promotion.promotionId == null
      ? await createScenarioPromotion(payload)
      : await updateScenarioPromotion(promotion.promotionId, payload);
    // The demo store does not resolve product names, so keep the page's.
    const saved = scenarioPromotionFromApi({ ...row, product_name: row.product_name ?? payload.product_name });
    setPromotions((current) =>
      current.map((item) => (item.id === promotion.id ? applySavedPromotion(item, promotion, saved) : item))
    );
  }

  async function deletePromotion(promotion) {
    requests.current.revision += 1;
    if (promotion.promotionId != null) await deleteScenarioPromotion(promotion.promotionId, plan);
    setPromotions((current) => current.filter((item) => item.id !== promotion.id));
  }

  return { promotions, setPromotions, savePromotion, deletePromotion, unsavedCount, loading, error, refresh: () => setRefreshKey((key) => key + 1) };
}
