'use client';

import { useState } from 'react';
import { Percent, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PROMO_UPLIFTS_DEMO } from '@/app/services/promoUpliftsApi';
import { SCENARIO_PROMOTIONS_DEMO } from '@/app/services/scenarioPromotionsApi';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import {
  clashingActivePromotions,
  discardPromotionChanges,
  effectiveUpliftRange,
  formatPctRange,
  hasUnsavedPromotionChanges,
  mechanicOptions,
  newDraftPromotion,
  settingsChange,
  skippedModelCells,
  updateDraftPromotion,
  formatPct,
  validateScenarioPromotion,
  withReferences,
} from '@/app/utils/scenarioPromotions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { primaryButtonClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import PromoHowItWorks from '@/components/scenario/PromoHowItWorks';
import PromotionEditor from '@/components/scenario/PromotionEditor';
import usePromoUplifts from '@/hooks/usePromoUplifts';

// Changing any of these picks the setting values again (withReferences).
const REFERENCE_FIELDS = ['customer', 'sku', 'mechanicKey'];

function SettingsChangedNote({ change, onUpdate }) {
  const parts = [];
  if (change.mechanicChanged) parts.push(`${formatPct(change.currentPct)} (saved with ${formatPct(change.savedPct)})`);
  if (change.voucherChanged) {
    parts.push(`voucher ${formatPct(change.currentVoucherPct)} (saved with ${formatPct(change.savedVoucherPct)})`);
  }
  return (
    <p className="rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] text-deep-violet-blue">
      Promotion uplift settings now say {parts.join(', ')}.{' '}
      <button type="button" onClick={onUpdate} className="font-medium text-scenario underline-offset-2 hover:underline">
        Update
      </button>
    </p>
  );
}

function statusText(promotion) {
  if (hasUnsavedPromotionChanges(promotion)) return 'Unsaved changes';
  return promotion.isActive ? 'Saved' : 'Saved, not on the chart';
}

function promotionSummary(promotion) {
  const span = monthSpanLabel([promotion.startMonth, promotion.endMonth].filter(Boolean));
  const voucher = promotion.voucher ? ' + voucher' : '';
  return `${promotion.sku || 'All SKUs'} · ${formatPctRange(effectiveUpliftRange(promotion))}${voucher} · ${span}`;
}

/**
 * Promotions tab of the Scenario builder panel: the planned promotions as
 * a list, and an editor for the selected one (Promotions Uplift design,
 * Section 6.1 step 6; same layout as BuildingBlocksSection). Edits go to
 * `onChange` and show on the chart at once; `onSave` and `onDelete`
 * (useScenarioPromotions) are the only calls that reach the server, and a
 * switched-off promotion stays saved but leaves the Simulated line.
 *
 * Uplift values come from Promotion uplift settings through usePromoUplifts
 * (the in-memory demo while PROMO_UPLIFTS_DEMO is on), never from this file. `rows` are the fetched forecast rows, used only to count the months
 * where no promotion uplift is added (design Section 6.4.5).
 *
 * @param {{
 *   items: object[],
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   onSave: (promotion: object) => Promise<void>,
 *   onDelete: (promotion: object) => Promise<void>,
 *   customerOptions: string[],
 *   productOptions: string[],
 *   months: string[],
 *   defaultCustomer: string,
 *   defaultSku: string,
 *   impacts: Map<string, { deltaUnits: number, deltaRevenue: number, months: string[] }>,
 *   rows: object[],
 * }} props
 */
export default function PromotionsSection({
  items,
  onChange,
  onSave,
  onDelete,
  customerOptions,
  productOptions,
  months,
  defaultCustomer,
  defaultSku,
  impacts,
  rows = [],
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState(null);
  const uplifts = usePromoUplifts({ customers: customerOptions });
  const selected = items.find((promotion) => promotion.id === selectedId) ?? items[0] ?? null;
  const addCustomer = defaultCustomer || customerOptions[0] || '';
  const canAdd = months.length > 0 && customerOptions.length > 0 && mechanicOptions(uplifts.data[addCustomer]).length > 0;
  const placeholderInUse = Object.values(uplifts.data).some((resolved) =>
    resolved.uplifts.some((row) => row.source === 'placeholder')
  );

  function addPromotion() {
    const promotion = newDraftPromotion({
      customer: addCustomer,
      // Promotions are planned per SKU; with All SKUs on the chart, start on
      // the first one.
      sku: defaultSku || productOptions[0] || '',
      months,
      resolved: uplifts.data[addCustomer],
    });
    onChange((current) => [...current, promotion]);
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
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(promotion);
      if (promotion.isActive) await switchOffClashes(promotion);
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

  // One switched-on promotion per slot (same customer, type, SKU and
  // months; promotionsClash). Saved ones are saved switched off straight
  // away, unsaved ones just switch off.
  async function switchOffClashes(promotion) {
    const clashes = clashingActivePromotions(promotion, items);
    if (!clashes.length) return;
    const ids = new Set(clashes.map((item) => item.id));
    onChange((current) => current.map((item) => (ids.has(item.id) ? { ...item, isActive: false } : item)));
    setNotice(
      `Switched off ${clashes.map((item) => item.mechanicLabel || 'a promotion').join(', ')}: ` +
        `${promotion.mechanicLabel || 'this promotion'} covers the same customer, SKU, type and months.`
    );
    for (const clash of clashes) {
      if (clash.saved && !hasUnsavedPromotionChanges(clash)) await onSave({ ...clash, isActive: false });
    }
  }

  function updateToCurrentSettings(promotion) {
    onChange((current) =>
      current.map((item) => (item.id === promotion.id ? withReferences(item, uplifts.data[item.customer]) : item))
    );
  }

  function applyChanges(promotion, changes) {
    const next = updateDraftPromotion(promotion, changes);
    const needsReferences = REFERENCE_FIELDS.some((field) => field in changes);
    return needsReferences ? withReferences(next, uplifts.data[next.customer]) : next;
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-deep-violet-blue/70">Plan a promotion and see its uplift on the chart.</p>
        {placeholderInUse ? (
          <span className="shrink-0 rounded-full border border-violet/40 bg-cream px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue/70">
            Placeholder values
          </span>
        ) : null}
      </div>

      <PromoHowItWorks />

      {SCENARIO_PROMOTIONS_DEMO ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-[11px] text-deep-violet-blue">
          Saving is in demo mode until the scenario promotions table is set up: saved promotions last until the
          page is reloaded.
        </p>
      ) : null}
      {PROMO_UPLIFTS_DEMO ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-[11px] text-deep-violet-blue">
          Demo mode: uplift values come from the Promotion uplift settings demo (not saved).
        </p>
      ) : null}
      {uplifts.error ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
          Promotion uplift values could not be loaded: {uplifts.error}
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
                  {retailerLabel(promotion.customer)} · {promotion.mechanicLabel || 'Draft promotion'}
                </span>
                <span className="block truncate text-[11px] text-deep-violet-blue/60">
                  {promotionSummary(promotion)}
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
                {impacts.has(promotion.id) || skippedModelCells(promotion, rows).count ? null : (
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

      {selected && settingsChange(selected, uplifts.data[selected.customer]) ? (
        <SettingsChangedNote
          change={settingsChange(selected, uplifts.data[selected.customer])}
          onUpdate={() => updateToCurrentSettings(selected)}
        />
      ) : null}

      {selected ? (
        <PromotionEditor
          promotion={selected}
          onUpdate={updateSelected}
          resolved={uplifts.data[selected.customer]}
          customerOptions={customerOptions}
          productOptions={productOptions}
          months={months}
          impact={impacts.get(selected.id)}
          skipped={skippedModelCells(selected, rows)}
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
            disabled={saving || !selected.sku || !hasUnsavedPromotionChanges(selected)}
            title={selected.sku ? undefined : 'Choose a single SKU to save this promotion'}
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
