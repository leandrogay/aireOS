'use client';

import { useCallback, useEffect, useState } from 'react';

import PromotionForm, { blankPromotionForm } from '@/components/promotions/PromotionForm';
import PromotionList from '@/components/promotions/PromotionList';
import {
  createPromotionPairs,
  deletePromotion,
  getPromotions,
  getRetailers,
  getStores,
  updatePromotion,
} from '@/app/services/promotionsApi';
import {
  buildPromotionPayload,
  buildUpdatePayload,
  formFromPromotion,
  getThursdayWeeksInMonth,
  resolveRetailerTargets,
  resolveSelectedPeriods,
  resolveSelectedStores,
  storeCatalogOptions,
  validatePromotionForm,
} from '@/app/utils/promotionForm';
import { promotionCombinationKey } from '@/app/utils/promotionOverview';

/**
 * Promotions page for AO4-1 create and AO4-2 overview.
 *
 * Monthly promotions POST to the existing /api/promotions routes. Weekly
 * side offers are validated on the page only until a weekly backend exists.
 * Retailers, stores, and the overview list come from GET after Cloud SQL ingest.
 */
export default function PromotionsPage() {
  const [form, setForm] = useState(blankPromotionForm);
  const [errors, setErrors] = useState({});
  const [retailers, setRetailers] = useState([]);
  const [stores, setStores] = useState([]);
  const [retailersError, setRetailersError] = useState('');
  const [storesError, setStoresError] = useState('');
  const [isLoadingRetailers, setIsLoadingRetailers] = useState(false);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [promotions, setPromotions] = useState([]);
  const [listError, setListError] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [highlightIds, setHighlightIds] = useState([]);
  const [editingPromotion, setEditingPromotion] = useState(null);

  /**
   * Load retailers for All / Specific scope from GET /api/catalog/retailers.
   */
  const loadRetailers = useCallback(async () => {
    setIsLoadingRetailers(true);
    setRetailersError('');

    try {
      const data = await getRetailers();
      setRetailers(data);
    } catch (error) {
      setRetailers([]);
      setRetailersError(error.message || 'Failed to load retailers.');
    } finally {
      setIsLoadingRetailers(false);
    }
  }, []);

  /**
   * Load the shared store catalog. Rows are de-duplicated by store_code
   * in the form, because the same store can exist under every retailer.
   */
  const loadStores = useCallback(async () => {
    setIsLoadingStores(true);
    setStoresError('');

    try {
      const data = await getStores();
      setStores(data);
    } catch (error) {
      setStores([]);
      setStoresError(error.message || 'Failed to load stores.');
    } finally {
      setIsLoadingStores(false);
    }
  }, []);

  /**
   * Apply a saved promotion to the overview immediately so staff do not
   * wait on GET /api/promotions or the Refresh button.
   *
   * @param {object | object[]} next
   */
  const applyPromotionsToOverview = (next) => {
    const rows = (Array.isArray(next) ? next : [next]).filter(
      (item) => item && item.promotion_id != null,
    );
    if (!rows.length) return;

    setPromotions((current) => {
      const byId = new Map(current.map((item) => [item.promotion_id, item]));
      for (const item of rows) {
        byId.set(item.promotion_id, item);
      }
      return [...byId.values()];
    });
  };

  /**
   * Load the monthly promotion overview from GET /api/promotions.
   *
   * @param {{ silent?: boolean }} [options]
   */
  const loadPromotions = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoadingList(true);
    setListError('');

    try {
      const data = await getPromotions();
      setPromotions(data);
    } catch (error) {
      if (!silent) setPromotions([]);
      setListError(error.message || 'Failed to load promotions.');
    } finally {
      if (!silent) setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadRetailers();
    loadStores();
    loadPromotions();
  }, [loadRetailers, loadStores, loadPromotions]);

  useEffect(() => {
    if (!editingPromotion || !retailers.length) return;

    const prefilled = formFromPromotion(editingPromotion, retailers);
    if (!prefilled.selectedRetailerIds.length) return;

    setForm((current) => {
      if (current.selectedRetailerIds.length) return current;
      return {
        ...current,
        selectedRetailerIds: prefilled.selectedRetailerIds,
      };
    });
  }, [editingPromotion, retailers]);

  /**
   * Update the form. After a failed submit, re-validate so a filled
   * required field drops its inline error immediately.
   *
   * @param {ReturnType<typeof blankPromotionForm>} nextForm
   */
  const handleFormChange = (nextForm) => {
    setForm(nextForm);
    setErrors((current) => {
      if (Object.keys(current).length === 0) return current;
      return validatePromotionForm(nextForm, retailers, stores, {
        mode: editingPromotion ? 'edit' : 'create',
      });
    });
  };

  /**
   * Open the pre-filled edit form for one overview row.
   *
   * @param {object} promotion
   */
  const handleEdit = (promotion) => {
    setEditingPromotion(promotion);
    setForm(formFromPromotion(promotion, retailers));
    setErrors({});
    setSubmitMessage('');
    setSubmitError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /**
   * Leave edit mode and restore a blank create form.
   */
  const handleCancelEdit = () => {
    setEditingPromotion(null);
    setForm({ ...blankPromotionForm(), offerKind: 'monthly' });
    setErrors({});
    setSubmitMessage('');
    setSubmitError('');
  };

  /**
   * DELETE /api/promotions/{id} for one overview row. The confirm dialog
   * in the list is the only path that reaches this handler.
   *
   * @param {object} promotion
   */
  const handleDelete = async (promotion) => {
    setSubmitMessage('');
    setSubmitError('');

    try {
      await deletePromotion(promotion.promotion_id);

      setPromotions((current) =>
        current.filter((item) => item.promotion_id !== promotion.promotion_id),
      );
      setHighlightIds((current) =>
        current.filter((id) => id !== promotion.promotion_id),
      );

      if (editingPromotion?.promotion_id === promotion.promotion_id) {
        setEditingPromotion(null);
        setForm({ ...blankPromotionForm(), offerKind: 'monthly' });
        setErrors({});
      }

      setSubmitMessage('Promotion deleted. It is no longer in the overview.');
      await loadPromotions({ silent: true });
    } catch (error) {
      setSubmitError(error.message || 'Failed to delete promotion.');
      throw error;
    }
  };

  /**
   * Validate, then either POST monthly promotions or acknowledge a weekly
   * UI-only draft. Invalid forms never call the API.
   *
   * @param {React.FormEvent<HTMLFormElement>} event
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitMessage('');
    setSubmitError('');

    const nextErrors = validatePromotionForm(form, retailers, stores, {
      mode: editingPromotion ? 'edit' : 'create',
    });
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if (editingPromotion) {
      const retailerNames = resolveRetailerTargets(form, retailers);
      const selectedStores = resolveSelectedStores(form, storeCatalogOptions(stores));

      if (retailerNames.length !== 1 || selectedStores.length !== 1) {
        setSubmitError('Choose one retailer and one store.');
        return;
      }

      const payload = buildUpdatePayload(
        form,
        selectedStores[0],
        retailerNames[0],
        editingPromotion,
      );
      const nextKey = promotionCombinationKey(payload);
      const clash = promotions.find(
        (item) =>
          item.promotion_id !== editingPromotion.promotion_id &&
          promotionCombinationKey(item) === nextKey,
      );

      if (clash) {
        setSubmitError(
          `This combination already exists for ${clash.retailer} / ${clash.store_name}.`,
        );
        return;
      }

      setIsSubmitting(true);

      try {
        const updated = await updatePromotion(editingPromotion.promotion_id, payload);
        applyPromotionsToOverview(updated);
        setHighlightIds(
          updated?.promotion_id != null ? [updated.promotion_id] : [editingPromotion.promotion_id],
        );
        setEditingPromotion(null);
        setForm({ ...blankPromotionForm(), offerKind: 'monthly' });
        setErrors({});
        setSubmitMessage('Promotion updated. The overview now shows the new details.');
        await loadPromotions({ silent: true });
      } catch (error) {
        setSubmitError(error.message || 'Failed to update promotion.');
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    if (form.offerKind === 'weekly') {
      const weeks = getThursdayWeeksInMonth(Number(form.weeklyYear), Number(form.weeklyMonth));
      const week = weeks.find((item) => item.weekStart === form.weeklyWeekStart);
      setSubmitMessage(
        `Weekly side offer captured on the page only (${week?.periodLabel || 'week'}, ${form.skuRanges.join(', ')}). It is not stored until the weekly backend exists.`,
      );
      return;
    }

    const retailerNames = resolveRetailerTargets(form, retailers);
    const selectedStores = resolveSelectedStores(form, storeCatalogOptions(stores));
    const selectedPeriods = resolveSelectedPeriods(form);
    const existingKeys = new Set(promotions.map((item) => promotionCombinationKey(item)));
    const newStoresByRetailer = [];
    const skipped = [];

    for (const period of selectedPeriods) {
      const periodPayload = buildPromotionPayload(form, selectedStores[0], period);

      for (const retailer of retailerNames) {
        for (const store of selectedStores) {
          const key = promotionCombinationKey({
            retailer,
            store_code: store.store_code,
            period_start: periodPayload.period_start,
            period_end: periodPayload.period_end,
            promo_type: periodPayload.promo_type,
            promotion_mechanic: periodPayload.promotion_mechanic,
          });

          if (existingKeys.has(key)) {
            skipped.push(`${retailer} / ${store.store_name} / ${period.periodLabel}`);
            continue;
          }

          existingKeys.add(key);
          newStoresByRetailer.push({ retailer, store, payload: periodPayload });
        }
      }
    }

    if (!newStoresByRetailer.length) {
      setSubmitError(
        skipped.length
          ? `This combination already exists for ${skipped.join('; ')}.`
          : 'This promotion combination already exists.',
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const { created, failed } = await createPromotionPairs(
        {},
        newStoresByRetailer,
      );

      const createdIds = created
        .map((promotion) => promotion.promotion_id)
        .filter((id) => id != null);

      applyPromotionsToOverview(created);
      setHighlightIds(createdIds);

      if (created.length && !failed.length) {
        const skipNote = skipped.length
          ? ` Skipped existing combinations: ${skipped.join('; ')}.`
          : '';
        setSubmitMessage(
          (created.length === 1
            ? 'Promotion created. It now appears in the overview.'
            : `${created.length} promotions created.`) + skipNote,
        );
        setForm({ ...blankPromotionForm(), offerKind: 'monthly' });
        setErrors({});
      } else if (created.length && failed.length) {
        setSubmitError(
          `Created ${created.length}, but ${failed.length} failed: ${failed
            .map((item) => `${item.retailer} / ${item.store}${item.period ? ` / ${item.period}` : ''} (${item.error})`)
            .join('; ')}`,
        );
      } else {
        setSubmitError(
          failed.map((item) => `${item.retailer} / ${item.store}${item.period ? ` / ${item.period}` : ''}: ${item.error}`).join(' ') ||
            'Failed to create promotion.',
        );
      }

      await Promise.all([
        loadPromotions({ silent: true }),
        loadRetailers(),
        loadStores(),
      ]);
    } catch (error) {
      setSubmitError(error.message || 'Failed to create promotion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream px-4 py-3 font-sans">
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
        <header>
          <h1 className="font-serif text-2xl text-deep-violet-blue">Promotions</h1>
          <p className="text-xs text-deep-violet-blue/80">
            {editingPromotion
              ? `Editing promotion ${editingPromotion.promotion_id} (${editingPromotion.store_name || 'store'}).`
              : 'Register a monthly promotion or a weekly side offer.'}
          </p>
        </header>

        {submitMessage && (
          <p className="rounded-md border border-violet bg-lavander p-2 text-sm text-deep-violet-blue">
            {submitMessage}
          </p>
        )}

        {submitError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {submitError}
          </p>
        )}

        <PromotionForm
          form={form}
          onChange={handleFormChange}
          retailers={retailers}
          stores={stores}
          retailersError={retailersError}
          storesError={storesError}
          isLoadingRetailers={isLoadingRetailers}
          isLoadingStores={isLoadingStores}
          isSubmitting={isSubmitting}
          errors={errors}
          onSubmit={handleSubmit}
          mode={editingPromotion ? 'edit' : 'create'}
          onCancel={handleCancelEdit}
        />

        <PromotionList
          promotions={promotions}
          isLoading={isLoadingList}
          error={listError}
          highlightIds={highlightIds}
          editingId={editingPromotion?.promotion_id}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRefresh={loadPromotions}
        />
      </div>
    </div>
  );
}
