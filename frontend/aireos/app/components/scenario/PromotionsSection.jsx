'use client';

import { useState } from 'react';
import { Percent, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { customersLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import {
  clashingActivePromotions,
  discardPromotionChanges,
  effectiveUpliftRange,
  formatPctRange,
  hasUnsavedPromotionChanges,
  mechanicOptions,
  newDraftPromotion,
  promotionScopeLabel,
  sourceLabel,
  stackedModelCells,
  updateDraftPromotion,
  upliftChangedSinceSaved,
  validateScenarioPromotion,
  withLiveReferences,
  withReferences,
} from '@/app/utils/scenarioPromotions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/formStyles';
import PromoHowItWorks from '@/components/scenario/PromoHowItWorks';
import PromotionEditor from '@/components/scenario/PromotionEditor';
import usePromoUplifts from '@/hooks/usePromoUplifts';

// Changing any of these picks the setting values again (withReferences).
const REFERENCE_FIELDS = ['customers', 'skuRanges', 'sku', 'mechanicKey'];

// A saved promotion takes the uplift worked out now; this says what it was
// when saved, so a change since then is never silent. Nothing to apply.
function SavedNowNote({ change }) {
  const savedLevel = sourceLabel(change.savedLevel);
  return (
    <p
      className="rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] text-deep-violet-blue"
      role="status"
    >
      When saved: {formatPctRange(change.saved)}
      {savedLevel ? ` · ${savedLevel}` : ''}. Now: <b>{formatPctRange(change.now)}</b> · {sourceLabel(change.nowLevel)}.
    </p>
  );
}

function statusText(promotion) {
  if (hasUnsavedPromotionChanges(promotion)) return 'Unsaved changes';
  return promotion.isActive ? 'Saved' : 'Saved, not on the chart';
}

function promotionSummary(promotion, liveIndex) {
  const span = monthSpanLabel([promotion.startMonth, promotion.endMonth].filter(Boolean));
  const voucher = promotion.voucher ? ' + voucher' : '';
  return `${promotionScopeLabel(promotion)} · ${formatPctRange(effectiveUpliftRange(promotion, liveIndex))}${voucher} · ${span}`;
}

/**
 * Promotions tab of the Scenario builder panel: the planned promotions as
 * a list, and an editor for the selected one (Promotions Uplift design,
 * Section 6.1 step 6; same layout as BuildingBlocksSection). Edits go to
 * `onChange` and show on the chart at once; `onSave` and `onDelete`
 * (useScenarioPromotions) are the only calls that reach the server, and a
 * switched-off promotion stays saved but leaves the Simulated line.
 *
 * Uplift values come from Promotion uplift settings, never from this file:
 * the mechanics, anchors and vouchers through usePromoUplifts, and the
 * worked-out uplift per product and month through `liveIndex`
 * (scenarioLiveUplifts.liveUpliftIndex of GET /promo-uplifts/calculated,
 * loaded by ScenarioBuilder; null while loading or when it failed, and then
 * the values saved with each promotion are used). `rows` are the fetched
 * forecast rows, used only to count the months where no promotion uplift is
 * added (design Section 6.4.5).
 *
 * @param {{
 *   items: object[],
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   onSave: (promotion: object) => Promise<void>,
 *   onDelete: (promotion: object) => Promise<void>,
 *   customerOptions: string[],
 *   skuRangeOptions: string[],
 *   months: string[],
 *   defaultCustomer: string,
 *   defaultSkuRange: string,
 *   impacts: Map<string, { deltaUnits: number, months: string[] }>,
 *   rows: object[],
 *   pairsFor: (promotion: object) => ReturnType<typeof import('@/app/utils/scenarioEngine').itemPairs>,
 *   liveIndex: Map<string, object[]> | null,
 *   liveLoading: boolean,
 *   liveError: string | null,
 * }} props
 */
export default function PromotionsSection({
  items,
  onChange,
  onSave,
  onDelete,
  customerOptions,
  skuRangeOptions,
  months,
  defaultCustomer,
  defaultSkuRange,
  impacts,
  rows = [],
  pairsFor,
  liveIndex = null,
  liveLoading = false,
  liveError = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState(null);
  const uplifts = usePromoUplifts({ customers: customerOptions });
  const selected = items.find((promotion) => promotion.id === selectedId) ?? items[0] ?? null;
  // The chart's customer to start with; none = every customer.
  const addCustomers = defaultCustomer ? [defaultCustomer] : [];
  const lead = addCustomers[0] ?? customerOptions[0];
  const canAdd = months.length > 0 && customerOptions.length > 0 && mechanicOptions(uplifts.data[lead]).length > 0;
  const savedNow = selected ? upliftChangedSinceSaved(selected, liveIndex) : null;

  function addPromotion() {
    const promotion = newDraftPromotion({
      customers: addCustomers,
      // The chart's range to start with; none picked = All SKU ranges.
      skuRanges: defaultSkuRange ? [defaultSkuRange] : [],
      months,
      upliftsByCustomer: uplifts.data,
    });
    const withLive = withLiveReferences(promotion, liveIndex);
    onChange((current) => [...current, withLive]);
    setSelectedId(promotion.id);
  }

  async function removePromotion(promotion) {
    setSaveError(null);
    try {
      await onDelete(promotion);
    } catch (err) {
      setSaveError(err.message);
    }
  }

  async function savePromotion(promotion) {
    const problem = validateScenarioPromotion(promotion);
    if (problem) {
      setSaveError(problem);
      return;
    }
    // Saved with what it is worth now, the "When saved" value from then on.
    const toSave = withLiveReferences(promotion, liveIndex);
    if (toSave !== promotion) {
      onChange((current) => current.map((item) => (item.id === promotion.id ? toSave : item)));
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(toSave);
      if (toSave.isActive) await switchOffClashes(toSave);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function discardPromotion(promotion) {
    const restored = discardPromotionChanges(promotion);
    setSaveError(null);
    onChange((current) =>
      restored
        ? current.map((item) => (item.id === promotion.id ? restored : item))
        : current.filter((item) => item.id !== promotion.id)
    );
  }

  function toggleActive(promotion, isActive) {
    onChange((current) => current.map((item) => (item.id === promotion.id ? { ...item, isActive } : item)));
    if (isActive) switchOffClashes(promotion).catch((err) => setSaveError(err.message));
  }

  // One switched-on promotion per slot (same customer, type, SKU range and
  // months; promotionsClash). Saved ones are saved switched off straight
  // away, unsaved ones just switch off.
  async function switchOffClashes(promotion) {
    const clashes = clashingActivePromotions(promotion, items);
    if (!clashes.length) return;
    const ids = new Set(clashes.map((item) => item.id));
    onChange((current) => current.map((item) => (ids.has(item.id) ? { ...item, isActive: false } : item)));
    setNotice(
      `Switched off ${clashes.map((item) => item.mechanicLabel || 'a promotion').join(', ')}: ` +
        `${promotion.mechanicLabel || 'this promotion'} covers the same customer, SKU range, type and months.`
    );
    for (const clash of clashes) {
      if (clash.saved && !hasUnsavedPromotionChanges(clash)) await onSave({ ...clash, isActive: false });
    }
  }

  function applyChanges(promotion, changes) {
    const next = updateDraftPromotion(promotion, changes);
    const needsReferences = REFERENCE_FIELDS.some((field) => field in changes);
    return needsReferences ? withReferences(next, uplifts.data, liveIndex) : next;
  }

  function updateSelected(changes) {
    onChange((current) =>
      current.map((promotion) => (promotion.id === selected.id ? applyChanges(promotion, changes) : promotion))
    );
  }

  // On wide screens ScenarioBuilder sizes the panel to the chart card and
  // scrolls this tab inside it.
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1 text-[11px] text-deep-violet-blue/70">
        Plan a promotion and see its uplift on the chart.
      </p>

      <PromoHowItWorks />

      {uplifts.error ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
          Promotion uplift values could not be loaded: {uplifts.error}
        </p>
      ) : null}
      {liveError ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
          Calculated uplifts could not be loaded; saved values are used: {liveError}
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {items.map((promotion) => (
          <li
            key={promotion.id}
            className={cn(
              'flex items-center gap-2 rounded-md border pr-2.5 transition',
              promotion.id === selected?.id
                ? 'border-deep-violet-blue bg-lavander/40'
                : 'border-lavander bg-white hover:bg-cream/60'
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedId(promotion.id)}
              aria-pressed={promotion.id === selected?.id}
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left',
                promotion.isActive ? null : 'opacity-60'
              )}
            >
              <Percent className="mt-0.5 size-3.5 shrink-0 text-scenario" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-deep-violet-blue">
                  {customersLabel(promotion.customers)} · {promotion.mechanicLabel || 'Draft promotion'}
                </span>
                <span className="block truncate text-[11px] text-deep-violet-blue/60">
                  {promotionSummary(promotion, liveIndex)}
                </span>
                <span
                  className={cn(
                    'block text-[11px]',
                    hasUnsavedPromotionChanges(promotion)
                      ? 'font-medium text-scenario-ink'
                      : 'italic text-deep-violet-blue/50'
                  )}
                >
                  {statusText(promotion)}
                </span>
                {impacts.has(promotion.id) ? null : (
                  <span className="block text-[11px] italic text-deep-violet-blue/50">
                    Not in current chart view
                  </span>
                )}
              </span>
            </button>
            <Switch
              checked={promotion.isActive}
              onCheckedChange={(checked) => toggleActive(promotion, checked)}
              aria-label={`${promotion.isActive ? 'Make inactive' : 'Make active'}: ${promotion.mechanicLabel || 'promotion'}`}
              title={promotion.isActive ? 'On the Simulated line' : 'Off the Simulated line'}
              className="data-checked:bg-scenario"
            />
          </li>
        ))}
      </ul>

      {items.length ? null : (
        <p className="text-xs text-deep-violet-blue/60">No promotions yet. Add one to start simulating.</p>
      )}

      <button
        type="button"
        onClick={addPromotion}
        disabled={!canAdd}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-deep-violet-blue/40 text-xs font-medium text-deep-violet-blue hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {uplifts.loading ? 'Loading uplift values…' : 'Add promotion'}
      </button>
      {months.length && customerOptions.length ? null : (
        <p className="text-[11px] text-deep-violet-blue/60">
          Pick a date range that includes forecast months to add promotions.
        </p>
      )}

      {notice ? (
        <p className="rounded-md border border-lavander bg-cream px-2.5 py-2 text-[11px] text-deep-violet-blue" role="status">
          {notice}{' '}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium text-scenario underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {savedNow ? <SavedNowNote change={savedNow} /> : null}

      {selected ? (
        <PromotionEditor
          promotion={selected}
          onUpdate={updateSelected}
          upliftsByCustomer={uplifts.data}
          pairs={pairsFor(selected)}
          liveIndex={liveIndex}
          liveLoading={liveLoading}
          customerOptions={customerOptions}
          skuRangeOptions={skuRangeOptions}
          months={months}
          impact={impacts.get(selected.id)}
          stacked={stackedModelCells(selected, rows)}
        />
      ) : null}

      {saveError ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
          {saveError}
        </p>
      ) : null}

      {/* Same action row as BlockEditor: Save, Discard changes, delete. */}
      {selected ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => savePromotion(selected)}
            disabled={saving || !hasUnsavedPromotionChanges(selected)}
            className={cn(primaryButtonClass, 'flex-1')}
          >
            {saving ? 'Saving…' : hasUnsavedPromotionChanges(selected) ? 'Save promotion' : 'Saved'}
          </Button>
          {selected.saved && hasUnsavedPromotionChanges(selected) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => discardPromotion(selected)}
              disabled={saving}
              className={secondaryButtonClass}
            >
              Discard changes
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => removePromotion(selected)}
            disabled={saving}
            aria-label={`Delete ${selected.mechanicLabel || 'promotion'}`}
            title="Delete promotion"
            className="border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
