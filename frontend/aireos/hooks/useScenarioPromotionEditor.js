'use client';

import { useState } from 'react';
import useConfirmAction from '@/hooks/useConfirmAction';
import usePromoUplifts from '@/hooks/usePromoUplifts';
import {
  clashingActivePromotions, discardPromotionChanges, hasUnsavedPromotionChanges, mechanicOptions,
  newDraftPromotion, updateDraftPromotion, validateScenarioPromotion, withLiveReferences, withReferences,
} from '@/app/utils/scenarioPromotions';

const REFERENCE_FIELDS = ['customers', 'skuRanges', 'sku', 'mechanicKey'];

/** Shared actions for the promotion sidebar editor and the complete saved-promotions table. */
export default function useScenarioPromotionEditor({
  items, onChange, onSave, onDelete, customerOptions = [], defaultCustomer, defaultSkuRange, months = [], liveIndex,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [togglingIds, setTogglingIds] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const uplifts = usePromoUplifts({ customers: customerOptions });
  const deletion = useConfirmAction({ onConfirm: deleteConfirmed });
  const panelItems = items.filter((item) => !item.saved || item.id === selectedId || hasUnsavedPromotionChanges(item));
  const selected = panelItems.find((item) => item.id === selectedId) ?? panelItems[0] ?? null;
  const lead = defaultCustomer || customerOptions[0];
  const canAdd = months.length > 0 && customerOptions.length > 0 && mechanicOptions(uplifts.data[lead]).length > 0;

  function replace(item) {
    onChange((current) => current.map((before) => before.id === item.id ? item : before));
  }

  function restoreActive(item) {
    onChange((current) => current.map((before) => before.id === item.id ? { ...before, isActive: item.isActive } : before));
  }

  function add() {
    const draft = newDraftPromotion({ customers: defaultCustomer ? [defaultCustomer] : [],
      skuRanges: defaultSkuRange ? [defaultSkuRange] : [], months, upliftsByCustomer: uplifts.data });
    const promotion = withLiveReferences(draft, liveIndex);
    onChange((current) => [...current, promotion]);
    setSelectedId(promotion.id);
    setError(null);
  }

  function updateSelected(changes) {
    if (!selected) return;
    onChange((current) => current.map((item) => {
      if (item.id !== selected.id) return item;
      const next = updateDraftPromotion(item, changes);
      return REFERENCE_FIELDS.some((field) => field in changes) ? withReferences(next, uplifts.data, liveIndex) : next;
    }));
  }

  async function switchOffClashes(promotion) {
    const clashes = clashingActivePromotions(promotion, items);
    if (!clashes.length) return;
    const ids = new Set(clashes.map((item) => item.id));
    onChange((current) => current.map((item) => ids.has(item.id) ? { ...item, isActive: false } : item));
    setNotice(`Switched off ${clashes.map((item) => item.mechanicLabel || 'a promotion').join(', ')}: ` +
      `${promotion.mechanicLabel || 'this promotion'} covers the same customer, SKU range, type and months.`);
    for (const clash of clashes) {
      if (!clash.saved || hasUnsavedPromotionChanges(clash)) continue;
      try {
        await onSave({ ...clash, isActive: false });
      } catch (err) {
        restoreActive(clash);
        throw new Error(`Could not switch off ${clash.mechanicLabel}: ${err.message}`);
      }
    }
  }

  async function save(promotion) {
    const problem = validateScenarioPromotion(promotion);
    if (problem) { setError(problem); return; }
    const toSave = withLiveReferences(promotion, liveIndex);
    if (toSave !== promotion) replace(toSave);
    setSaving(true);
    setError(null);
    try {
      await onSave(toSave);
      if (toSave.isActive) await switchOffClashes(toSave);
      setSelectedId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleSaved(promotion, isActive) {
    const next = { ...promotion, isActive };
    setError(null);
    setTogglingIds((current) => [...current, promotion.id]);
    replace(next);
    let saved = false;
    try {
      await onSave(next);
      saved = true;
      if (isActive) await switchOffClashes(next);
    } catch (err) {
      if (!saved) restoreActive(promotion);
      setError(err.message);
    } finally {
      setTogglingIds((current) => current.filter((id) => id !== promotion.id));
    }
  }

  function toggleDraft(promotion, isActive) {
    const next = { ...promotion, isActive };
    replace(next);
    if (isActive) switchOffClashes(next).catch((err) => setError(err.message));
  }

  function discard(promotion) {
    const restored = discardPromotionChanges(promotion);
    onChange((current) => current.map((item) => item.id === promotion.id ? restored : item).filter(Boolean));
    setSelectedId(null);
    setError(null);
  }

  async function deleteConfirmed(promotion) {
    setError(null);
    try {
      await onDelete(promotion);
      setSelectedId((id) => id === promotion.id ? null : id);
    } catch (err) {
      setError(err.message);
    }
  }

  function requestDelete(promotion) {
    if (promotion.saved) deletion.request(promotion);
    else {
      onChange((current) => current.filter((item) => item.id !== promotion.id));
      setSelectedId((id) => id === promotion.id ? null : id);
    }
  }

  return { panelItems, selected, uplifts, canAdd, saving, togglingIds, error, notice, deletion,
    savedCount: items.filter((item) => item.saved).length,
    select: setSelectedId, add, updateSelected, save, discard, toggleSaved, toggleDraft, requestDelete,
    clearError: () => setError(null), dismissNotice: () => setNotice(null) };
}
