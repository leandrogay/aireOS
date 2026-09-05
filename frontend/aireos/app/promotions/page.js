'use client';

import { useCallback, useEffect, useState } from 'react';

import PromotionForm, { blankPromotionForm } from '@/components/promotions/PromotionForm';
import PromotionList from '@/components/promotions/PromotionList';
import {
  createPromotionsForRetailersAndStores,
  getPromotions,
  getRetailers,
  getStores,
} from '@/app/services/promotionsApi';
import {
  buildPromotionPayload,
  getThursdayWeeksInMonth,
  resolveRetailerTargets,
  resolveSelectedStores,
  storeCatalogOptions,
  validatePromotionForm,
} from '@/app/utils/promotionForm';

/**
 * Promotions page for AO4-1.
 *
 * Monthly promotions POST to the existing /api/promotions routes. Weekly
 * side offers are validated on the page only until a weekly backend exists.
 * Retailers and stores come from GET after Cloud SQL ingest.
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

  /**
   * Load retailers for All / Specific scope from GET /api/promotions/retailers.
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
   * Load the monthly promotion overview from GET /api/promotions.
   */
  const loadPromotions = useCallback(async () => {
    setIsLoadingList(true);
    setListError('');

    try {
      const data = await getPromotions();
      setPromotions(data);
    } catch (error) {
      setPromotions([]);
      setListError(error.message || 'Failed to load promotions.');
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadRetailers();
    loadStores();
    loadPromotions();
  }, [loadRetailers, loadStores, loadPromotions]);

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
   * Validate, then either POST monthly promotions or acknowledge a weekly
   * UI-only draft. Invalid forms never call the API.
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
    const sharedPayload = buildPromotionPayload(form, selectedStores[0]);

    setIsSubmitting(true);

    try {
      const { created, failed } = await createPromotionsForRetailersAndStores(
        sharedPayload,
        retailerNames,
        selectedStores,
      );

      const createdIds = created
        .map((promotion) => promotion.promotion_id)
        .filter((id) => id != null);

      setHighlightIds(createdIds);

      if (created.length && !failed.length) {
        setSubmitMessage(
          created.length === 1
            ? 'Promotion created. It now appears in the overview.'
            : `${created.length} promotions created (${retailerNames.length} retailers × ${selectedStores.length} stores).`,
        );
        setForm({ ...blankPromotionForm(), offerKind: 'monthly' });
        setErrors({});
      } else if (created.length && failed.length) {
        setSubmitError(
          `Created ${created.length}, but ${failed.length} failed: ${failed
            .map((item) => `${item.retailer} / ${item.store} (${item.error})`)
            .join('; ')}`,
        );
      } else {
        setSubmitError(
          failed.map((item) => `${item.retailer} / ${item.store}: ${item.error}`).join(' ') ||
            'Failed to create promotion.',
        );
      }

      await Promise.all([loadPromotions(), loadRetailers(), loadStores()]);
    } catch (error) {
      setSubmitError(error.message || 'Failed to create promotion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream px-4 py-6 font-sans">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header>
          <h1 className="font-serif text-3xl text-deep-violet-blue">Promotions</h1>
          <p className="text-sm text-deep-violet-blue/80">
            Register a monthly promotion or a weekly side offer.
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
        />

        <PromotionList
          promotions={promotions}
          isLoading={isLoadingList}
          error={listError}
          highlightIds={highlightIds}
          onRefresh={loadPromotions}
        />
      </div>
    </div>
  );
}
