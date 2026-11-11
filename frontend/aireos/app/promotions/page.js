'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import Toast from '@/components/ui/Toast';
import PromotionForm, { blankPromotionForm } from '@/components/promotions/PromotionForm';
import PromotionList from '@/components/promotions/PromotionList';
import useExpandedRows from '@/hooks/useExpandedRows';
import useToast from '@/hooks/useToast';
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
  promotionStoreNames,
} from '@/app/utils/promotionOverview';

/**
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
  // True from the start, like isLoadingList: all three load on mount, and
  // the loaders only set state after their request returns.
  const [isLoadingRetailers, setIsLoadingRetailers] = useState(true);
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isLoadingSkuRanges, setIsLoadingSkuRanges] = useState(true);
  const [promotions, setPromotions] = useState([]);
  const [listError, setListError] = useState('');
  // True from the start: the list loads on mount, so the first paint shows
  // placeholder rows rather than the "no promotions yet" message.
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Form-level errors, shown inside the modal. Outcomes (created, updated,
  // deleted, delete failed) are toasts, so the page itself never shifts.
  const [submitError, setSubmitError] = useState('');
  const { toast, notify, dismissToast } = useToast();
  const [highlightIds, setHighlightIds] = useState([]);
  const expanded = useExpandedRows();
  const [editingPromotion, setEditingPromotion] = useState(null);
  // Edit was opened before the retailer list arrived, so the form's retailer
  // ticks are still empty (formFromPromotion matches against `retailers`).
  const [needsRetailerPrefill, setNeedsRetailerPrefill] = useState(false);
  // The create / edit form opens in a modal over the overview.
  const [isFormOpen, setIsFormOpen] = useState(false);

  /**
   * Load retailers for All / Specific scope from GET /api/catalog/retailers.
   */
  const loadRetailers = useCallback(async () => {
    try {
      const data = await getRetailers();
      setRetailers(data);
      setRetailersError('');
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
    try {
      const data = await getStores();
      setStores(data);
      setStoresError('');
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
    try {
      const data = await getSkuRanges();
      setSkuRangeOptions(data);
      setSkuRangesError('');
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
   * Load the promotion overview from GET /api/promotions. Silent: it sets
   * state only once the request returns (refreshPromotions shows the
   * placeholder rows first).
   */
  const loadPromotions = useCallback(async () => {
    try {
      const data = await getPromotions();
      setPromotions(data);
      setListError('');
    } catch (error) {
      // Rows already loaded stay on screen under the error and its Retry.
      setListError(error.message || 'Failed to load promotions.');
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  /**
   * Refresh / Retry on the overview: placeholder rows, then reload.
   */
  const refreshPromotions = () => {
    setIsLoadingList(true);
    loadPromotions();
  };

  useEffect(() => {
    async function loadPage() {
      await Promise.all([loadRetailers(), loadStores(), loadSkuRanges(), loadPromotions()]);
    }

    loadPage();
  }, [loadRetailers, loadStores, loadSkuRanges, loadPromotions]);

  // Adjust state during render, once: when the retailer list arrives after
  // Edit was opened, tick the promotion's retailers unless the user already
  // ticked some.
  if (needsRetailerPrefill && editingPromotion && retailers.length) {
    setNeedsRetailerPrefill(false);
    const { selectedRetailerIds } = formFromPromotion(editingPromotion, retailers);
    if (selectedRetailerIds.length && !form.selectedRetailerIds.length) {
      setForm({ ...form, selectedRetailerIds });
    }
  }

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
   * Open the modal with a blank create form.
   */
  const handleCreate = () => {
    setEditingPromotion(null);
    setNeedsRetailerPrefill(false);
    setForm(blankPromotionForm());
    setErrors({});
    setSubmitError('');
    setIsFormOpen(true);
  };

  /**
   * Open the modal pre-filled for one overview row.
   *
   * @param {object} promotion
   */
  const handleEdit = (promotion) => {
    setEditingPromotion(promotion);
    setNeedsRetailerPrefill(retailers.length === 0);
    setForm(formFromPromotion(promotion, retailers));
    setErrors({});
    setSubmitError('');
    setIsFormOpen(true);
  };

  /**
   * Close the modal (Cancel, X, Escape or backdrop) and leave edit mode.
   * Ignored while a save is in flight so the request is never abandoned
   * with no result shown.
   */
  const handleCloseForm = () => {
    if (isSubmitting) return;
    setIsFormOpen(false);
    setEditingPromotion(null);
    setNeedsRetailerPrefill(false);
    setForm(blankPromotionForm());
    setErrors({});
    setSubmitError('');
  };

  /**
   * DELETE /api/promotions/{id} for one overview row. The confirm dialog
   * in the list is the only path that reaches this handler; it closes
   * either way, so a failure is reported here as a toast, not thrown.
   *
   * @param {object} promotion
   */
  const handleDelete = async (promotion) => {
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

      notify('deleted', 'Promotion deleted');
      await loadPromotions();
    } catch (error) {
      notify('error', error.message || 'Failed to delete promotion.');
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
        const updatedId = updated?.promotion_id ?? editingPromotion.promotion_id;
        setHighlightIds([updatedId]);
        expanded.expand(updatedId);
        setIsFormOpen(false);
        setEditingPromotion(null);
        setForm(blankPromotionForm());
        setErrors({});
        notify('updated', 'Promotion updated');
        await loadPromotions();
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
      if (created?.promotion_id != null) expanded.expand(created.promotion_id);

      // Short enough to read in the toast's few seconds; the new row is
      // also highlighted in the overview.
      const storeCount = promotionStoreNames(created).length || newStores.length;
      const skipNote = skipped.length
        ? ` · ${skipped.length} skipped`
        : '';
      // Amber when some stores were skipped, so that part is not missed.
      notify(
        skipped.length ? 'warning' : 'created',
        (storeCount === 1 ? 'Promotion created' : `Created in ${storeCount} stores`) +
          skipNote,
      );
      setIsFormOpen(false);
      setForm(blankPromotionForm());
      setErrors({});

      await Promise.all([
        loadPromotions(),
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
    <PageLayout
      title="Promotions"
      headerExtra={
        <Button
          onClick={handleCreate}
          className="w-full bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90 md:w-auto"
        >
          <Plus data-icon="inline-start" />
          Create promotion
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <PromotionList
          promotions={promotions}
          isLoading={isLoadingList}
          error={listError}
          highlightIds={highlightIds}
          editingId={editingPromotion?.promotion_id}
          isExpanded={expanded.isExpanded}
          onToggle={expanded.toggle}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRefresh={refreshPromotions}
        />
      </div>

      {/* The form brings its own white card, so the dialog shell is bare.
          It follows the window: full width minus a gutter up to 5xl, and it
          scrolls when the window is shorter than the form. The form's
          dropdowns are portaled popovers, so scrolling never clips them. */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseForm();
        }}
      >
        <DialogContent
          aria-label={editingPromotion ? 'Edit promotion' : 'Create promotion'}
          className="max-h-[calc(100dvh-2rem)] gap-2 overflow-y-auto bg-transparent p-0 ring-0 sm:max-w-[min(64rem,calc(100%-2rem))]"
        >
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
            onCancel={handleCloseForm}
          />
          {submitError && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700"
            >
              {submitError}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
