'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import PromotionForm, { blankPromotionForm } from '@/components/promotions/PromotionForm';
import PromotionList from '@/components/promotions/PromotionList';
import {
  createPromotion,
  deletePromotion,
  getPromotions,
  getRetailers,
  getSkuRanges,
  getStores,
  updatePromotion,
} from '@/app/services/promotionsApi';
import {
  buildPromotionPayload,
  formFromPromotion,
  resolvePromotionStores,
  resolveSelectedPeriods,
  validatePromotionForm,
} from '@/app/utils/promotionForm';
import {
  promotionStoreKey,
  storesCoveredByEvent,
  summariseNames,
  promotionStoreNames,
} from '@/app/utils/promotionOverview';

/**
 * Promotions page for AO4-1 create and AO4-2 overview.
 *
 * One promotion spans many stores, so create is a single POST to
 * /api/promotions with every ticked retailer/store in `stores`.
 * Retailers, stores, and the overview list come from GET after
 * Cloud SQL ingest.
 */
export default function PromotionsPage() {
  const [form, setForm] = useState(blankPromotionForm);
  const [errors, setErrors] = useState({});
  const [retailers, setRetailers] = useState([]);
  const [stores, setStores] = useState([]);
  const [retailersError, setRetailersError] = useState('');
  const [storesError, setStoresError] = useState('');
  const [skuRangeOptions, setSkuRangeOptions] = useState([]);
  const [skuRangesError, setSkuRangesError] = useState('');
  const [isLoadingRetailers, setIsLoadingRetailers] = useState(false);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [isLoadingSkuRanges, setIsLoadingSkuRanges] = useState(false);
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
   * Load distinct SKU ranges from GET /api/catalog/sku-ranges.
   */
  const loadSkuRanges = useCallback(async () => {
    setIsLoadingSkuRanges(true);
    setSkuRangesError('');

    try {
      const data = await getSkuRanges();
      setSkuRangeOptions(data);
    } catch (error) {
      setSkuRangeOptions([]);
      setSkuRangesError(error.message || 'Failed to load SKU ranges.');
    } finally {
      setIsLoadingSkuRanges(false);
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
   * Load the promotion overview from GET /api/promotions.
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
    loadSkuRanges();
    loadPromotions();
  }, [loadRetailers, loadStores, loadSkuRanges, loadPromotions]);

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
      return validatePromotionForm(nextForm, retailers, stores);
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
    setForm(blankPromotionForm());
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
        setForm(blankPromotionForm());
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
   * Validate, then POST or PUT one promotion. Invalid forms never call
   * the API.
   *
   * @param {React.FormEvent<HTMLFormElement>} event
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitMessage('');
    setSubmitError('');

    const nextErrors = validatePromotionForm(form, retailers, stores);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const storeRefs = resolvePromotionStores(form, retailers, stores);

    if (!storeRefs.length) {
      setSubmitError('Choose stores that belong to the selected retailers.');
      return;
    }

    if (editingPromotion) {
      const payload = buildPromotionPayload(form, storeRefs);
      const covered = storesCoveredByEvent(
        promotions,
        payload,
        editingPromotion.promotion_id,
      );
      const clashes = payload.stores.filter((store) => covered.has(promotionStoreKey(store)));

      if (clashes.length) {
        setSubmitError(
          `This combination already exists for ${clashes
            .map((store) => `${store.retailer} / ${store.store_name}`)
            .join('; ')}.`,
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
        setForm(blankPromotionForm());
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

    const [period] = resolveSelectedPeriods(form);
    const payload = buildPromotionPayload(form, storeRefs, period);

    // Stores already running this exact event (period, type, mechanic)
    // are dropped from the request rather than duplicated.
    const covered = storesCoveredByEvent(promotions, payload);
    const skipped = [];
    const newStores = [];

    for (const store of payload.stores) {
      if (covered.has(promotionStoreKey(store))) {
        skipped.push(`${store.retailer} / ${store.store_name}`);
        continue;
      }
      newStores.push(store);
    }

    if (!newStores.length) {
      setSubmitError(
        skipped.length
          ? `This combination already exists for ${skipped.join('; ')}.`
          : 'This promotion combination already exists.',
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await createPromotion({ ...payload, stores: newStores });

      applyPromotionsToOverview(created);
      setHighlightIds(created?.promotion_id != null ? [created.promotion_id] : []);

      const storeCount = promotionStoreNames(created).length || newStores.length;
      const skipNote = skipped.length
        ? ` Skipped stores already running this promotion: ${skipped.join('; ')}.`
        : '';
      setSubmitMessage(
        (storeCount === 1
          ? 'Promotion created. It now appears in the overview.'
          : `Promotion created across ${storeCount} stores.`) + skipNote,
      );
      setForm(blankPromotionForm());
      setErrors({});

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
    <AppShell>
      <main>
        <div className="min-h-screen bg-cream px-4 py-3 font-sans">
          <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
            <header>
              <h1 className="font-serif text-2xl text-deep-violet-blue">Promotions</h1>
              <p className="text-xs text-deep-violet-blue/80">
                {editingPromotion
                  ? `Editing promotion ${editingPromotion.promotion_id} (${summariseNames(
                      promotionStoreNames(editingPromotion),
                      'no stores',
                    )}).`
                  : 'Register a promotion.'}
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
              skuRangeOptions={skuRangeOptions}
              retailersError={retailersError}
              storesError={storesError}
              skuRangesError={skuRangesError}
              isLoadingRetailers={isLoadingRetailers}
              isLoadingStores={isLoadingStores}
              isLoadingSkuRanges={isLoadingSkuRanges}
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
      </main>
    </AppShell>
  );
}
