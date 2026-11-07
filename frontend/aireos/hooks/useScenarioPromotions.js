'use client';

import { useEffect, useState } from 'react';

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
 * }}
 */
export default function useScenarioPromotions() {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const unsavedCount = promotions.filter(hasUnsavedPromotionChanges).length;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getScenarioPromotions();
        if (!cancelled) setPromotions(rows.map(scenarioPromotionFromApi));
      } catch (err) {
        if (!cancelled) setError(`Couldn't load saved promotions: ${err.message}`);
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

  async function savePromotion(promotion) {
    const payload = buildScenarioPromotionPayload(promotion);
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
    if (promotion.promotionId != null) await deleteScenarioPromotion(promotion.promotionId);
    setPromotions((current) => current.filter((item) => item.id !== promotion.id));
  }

  return { promotions, setPromotions, savePromotion, deletePromotion, unsavedCount, loading, error };
}
