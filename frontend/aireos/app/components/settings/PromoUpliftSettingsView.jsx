'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { cardClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import FilterSelect from '@/components/ui/FilterSelect';
import RefreshButton from '@/components/ui/RefreshButton';
import { Switch } from '@/components/ui/switch';
import Toast from '@/components/ui/Toast';
import useConfirmAction from '@/hooks/useConfirmAction';
import usePromoMeasureOnOpen from '@/hooks/usePromoMeasureOnOpen';
import usePromoUpliftFilterOptions from '@/hooks/usePromoUpliftFilterOptions';
import usePromoUpliftSettings from '@/hooks/usePromoUpliftSettings';
import useToast from '@/hooks/useToast';
import {
  archivePromoUplift,
  resetPromoAnchor,
  resetPromoRule,
  resetPromoUplift,
  restorePromoUplift,
  savePromoUplift,
} from '@/app/services/promoUpliftsApi';
import {
  DEFAULT_UPLIFT_PER_POINT_PCT,
  measurementToastSuffix,
  scopeLabel,
  shownUplift,
  upliftRowApplies,
} from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { HOW_THIS_PAGE_WORKS, PROMO_HINTS } from '@/app/utils/promoUpliftHints';

import PromoAnchorForm from './PromoAnchorForm';
import PromoAnchorTable from './PromoAnchorTable';
import PromoEvidenceDialog from './PromoEvidenceDialog';
import PromoHistoryDialog from './PromoHistoryDialog';
import PromoMeasurementPanel from './PromoMeasurementPanel';
import PromoMechanicForm from './PromoMechanicForm';
import PromoRuleCard from './PromoRuleCard';
import PromoRuleDialog from './PromoRuleDialog';
import PromoUpliftEditDialog from './PromoUpliftEditDialog';
import PromoUpliftTable from './PromoUpliftTable';

const EMPTY_FILTERS = { customer: '', sku: '' };

function anchorEditTarget(row) {
  return { customerId: row.customer_id, name: retailerLabel(row.customer_name), anchorPct: row.anchor_pct, row };
}

/**
 * The Promotion uplift settings page (Forecast > Promotion uplift settings):
 * each customer's ordinary-month discount, the uplift per mechanic used when
 * planning future promotions in the Scenario builder (filtered by customer
 * and SKU, which come from the catalogue), and promotion mechanics that match
 * no setting. New promotions and vouchers are added here; customers and SKUs
 * never are. Every write is a new version (nothing is deleted, archiving
 * included), recorded as UPDATED_BY; after a write the page refetches, since
 * an anchor or rule change moves every rule-based uplift. Uplifts are
 * measured from sales data automatically after a sales upload or a promotion
 * change, and when this page opens if anything changed since
 * (PromoMeasurementPanel, usePromoMeasureOnOpen), and after any save here that
 * can change a measured value: the backend measures in the same request, so
 * the refetch after the save already shows the new values, and the toast says
 * what moved. Uplifts typed here are never overwritten by a measurement.
 *
 * While PROMO_UPLIFTS_DEMO is on (services/promoUpliftsApi.js), every
 * button works against an in-memory demo and nothing is saved.
 */
export default function PromoUpliftSettingsView() {
  const [writes, setWrites] = useState(0);
  const [savesInFlight, setSavesInFlight] = useState(0);
  const openCheck = usePromoMeasureOnOpen();
  // Refetch after any write here and after the page-load check measured.
  const refreshKey = writes + openCheck.runs;
  const { settings, anchors, loading, error } = usePromoUpliftSettings({ refreshKey });
  const filterOptions = usePromoUpliftFilterOptions({ refreshKey });
  const readOnly = !settings;
  const [anchorTarget, setAnchorTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [evidenceTarget, setEvidenceTarget] = useState(null);
  const [editingRule, setEditingRule] = useState(false);
  const [addingMechanic, setAddingMechanic] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showArchived, setShowArchived] = useState(false);
  const { toast, notify, dismissToast } = useToast();
  const reset = useConfirmAction({ onConfirm: handleUpliftReset });
  const archive = useConfirmAction({ onConfirm: handleUpliftArchive });

  const refresh = () => setWrites((count) => count + 1);

  // A save that wrote a new version measures promotion uplifts in the same
  // request (backend _measured), so it can take a few seconds; the panel says
  // "Updating measured uplifts…" meanwhile.
  async function track(save) {
    setSavesInFlight((count) => count + 1);
    try {
      return await save;
    } finally {
      setSavesInFlight((count) => count - 1);
    }
  }
  const rows = settings?.settings ?? [];
  const rule = settings?.rule ?? null;
  const rate = rule?.uplift_per_point_pct ?? DEFAULT_UPLIFT_PER_POINT_PCT;
  const labelForKey = (key) => rows.find((row) => row.mechanic_key === key)?.mechanic_label ?? key;

  // Rule-based uplifts follow the picked customer's own ordinary-month
  // discount, as the Scenario builder uses them; otherwise the all-customers one.
  const customerAnchor = anchors?.customers.find((row) => row.customer_name === filters.customer) ?? null;
  const anchorPct = customerAnchor?.anchor_pct ?? settings?.default_anchor_pct ?? 20;
  const skuRow = filterOptions.skus.find((row) => row.sku === filters.sku) ?? null;
  const matchingRows = rows.filter((row) => upliftRowApplies(row, filters, skuRow));
  const archivedCount = matchingRows.filter((row) => row.archived_at).length;
  const shownRows = showArchived ? matchingRows : matchingRows.filter((row) => !row.archived_at);
  const hasFilters = filters.customer !== '' || filters.sku !== '';
  const customerOptions = filterOptions.customers.map((row) => ({
    value: row.customer_name,
    label: retailerLabel(row.customer_name),
  }));
  const skuOptions = filterOptions.skus.map((row) => ({ value: row.sku, label: `${row.product_name} · ${row.sku}` }));

  function editUplift(row) {
    setEditTarget({ row, shownUplift: shownUplift(row, anchorPct, rate) });
  }

  // History's "Edit details" button: only for a row its menu could edit.
  function historyEdit(target) {
    if (target.kind === 'rule') {
      return () => {
        setHistoryTarget(null);
        setEditingRule(true);
      };
    }
    if (target.kind === 'anchor') {
      return () => {
        setHistoryTarget(null);
        setAnchorTarget(anchorEditTarget(target.row));
      };
    }
    if (target.row.archived_at || target.row.source === 'learned') return null;
    return () => {
      setHistoryTarget(null);
      editUplift(target.row);
    };
  }

  function handleAnchorSaved(result, target) {
    setAnchorTarget(null);
    refresh();
    notify(
      'success',
      result.changed
        ? `Ordinary-month discount for ${target.name} saved${measurementToastSuffix(result.measurement)}`
        : 'No changes to save: the discount is already set to this value'
    );
  }

  async function handleAnchorReset(row) {
    try {
      const result = await track(resetPromoAnchor(row.customer_id));
      refresh();
      notify(
        'success',
        `${retailerLabel(row.customer_name)} now uses ${result.anchor.anchor_pct}% (from its data)${measurementToastSuffix(result.measurement)}`
      );
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleUpliftSave(row, upliftPct, note) {
    try {
      const result = await track(savePromoUplift(row.id, { uplift_pct: upliftPct, note }));
      setEditTarget(null);
      refresh();
      notify(
        'success',
        result.changed
          ? `${row.mechanic_label} saved as an Estimate${measurementToastSuffix(result.measurement)}`
          : 'No changes to save'
      );
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  }

  async function handleUpliftReset(row) {
    try {
      const result = await track(resetPromoUplift(row.id));
      refresh();
      notify('success', `${row.mechanic_label} follows the rule again${measurementToastSuffix(result.measurement)}`);
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleUpliftArchive(row) {
    try {
      const result = await track(archivePromoUplift(row.id));
      refresh();
      notify(
        'success',
        `${row.mechanic_label} archived. Turn on Show archived to see or restore it${measurementToastSuffix(result.measurement)}.`
      );
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleUpliftRestore(row) {
    try {
      const result = await track(restorePromoUplift(row.id));
      refresh();
      notify('success', `${row.mechanic_label} restored${measurementToastSuffix(result.measurement)}`);
    } catch (err) {
      notify('error', err.message);
    }
  }

  function handleRuleSaved(result) {
    setEditingRule(false);
    refresh();
    notify(
      result.warning ? 'error' : 'success',
      result.changed
        ? `Rule saved: ${result.rule.uplift_per_point_pct}% per extra point of discount${measurementToastSuffix(result.measurement)}${result.warning ? `. ${result.warning}` : ''}`
        : 'No changes to save: the rule already uses this rate'
    );
  }

  async function handleRuleReset() {
    try {
      const result = await track(resetPromoRule());
      refresh();
      notify(
        'success',
        result.changed
          ? `Rule back to the default ${DEFAULT_UPLIFT_PER_POINT_PCT}% per point${measurementToastSuffix(result.measurement)}`
          : 'The rule already uses the default'
      );
    } catch (err) {
      notify('error', err.message);
    }
  }

  function handleMechanicAdded(result) {
    setAddingMechanic(false);
    refresh();
    notify('success', `${result.setting.mechanic_label} added${measurementToastSuffix(result.measurement)}`);
  }

  return (
    <div className="grid gap-1">
      <section className={cardClass}>
        <p className="text-sm text-deep-violet-blue/80">
          How much a promotion lifts sales, used when planning <b>future</b> promotions in the Scenario builder.
        </p>
        <details className="group mt-1 text-xs text-deep-violet-blue/70">
          <summary className="cursor-pointer select-none font-medium text-deep-violet-blue/70 hover:text-deep-violet-blue">
            How this page works
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {HOW_THIS_PAGE_WORKS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
        {error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <PromoMeasurementPanel
        refreshKey={refreshKey}
        checking={openCheck.checking}
        updating={savesInFlight > 0}
        readOnly={readOnly}
        labelForKey={labelForKey}
        onChanged={refresh}
        notify={notify}
      />

      <section className={cardClass}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            Ordinary-month discount by customer
            <InfoTooltip label="About the ordinary-month discount" className="w-80">{PROMO_HINTS.anchor}</InfoTooltip>
          </h2>
          <RefreshButton onClick={refresh} isRefreshing={loading} label="Refresh promotion uplift settings" />
        </div>
        {anchors ? (
          <PromoAnchorTable
            anchors={anchors}
            readOnly={readOnly}
            onEdit={setAnchorTarget}
            onReset={handleAnchorReset}
            onHistory={(row) => setHistoryTarget({ kind: 'anchor', row })}
          />
        ) : (
          <p className="text-sm text-deep-violet-blue/60">Loading…</p>
        )}
      </section>

      <PromoRuleCard
        rule={rule}
        readOnly={readOnly}
        onEdit={() => setEditingRule(true)}
        onHistory={() => setHistoryTarget({ kind: 'rule', row: rule })}
        onReset={handleRuleReset}
      />

      {settings?.unmapped_mechanics?.length ? (
        <section className={cardClass} role="status">
          <h2 className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            These promotion mechanics have no uplift yet
            <InfoTooltip label="About unmatched mechanics" className="w-80">{PROMO_HINTS.unmapped}</InfoTooltip>
          </h2>
          <p className="mt-1 text-xs text-deep-violet-blue/70">
            {settings.unmapped_mechanics
              .map((row) => `${row.promotion_mechanic} (${row.promotions} promotion${row.promotions === 1 ? '' : 's'})`)
              .join(' · ')}
          </p>
        </section>
      ) : null}

      <section className={cardClass}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            Uplift by mechanic
            <InfoTooltip label="About uplift by mechanic" className="w-80">{PROMO_HINTS.upliftTable}</InfoTooltip>
          </h2>
          {readOnly ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddingMechanic(true)}
              className={secondaryButtonClass}
            >
              <Plus aria-hidden="true" />
              Add promotion or voucher
            </Button>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div
            role="group"
            aria-label="Filter uplift values"
            className="grid w-full gap-3 sm:w-auto sm:grid-cols-[12rem_18rem]"
          >
            <FilterSelect
              label="Customer"
              value={filters.customer}
              allLabel="All customers"
              options={customerOptions}
              onChange={(value) => setFilters((current) => ({ ...current, customer: value }))}
            />
            <FilterSelect
              label="SKU"
              value={filters.sku}
              allLabel="All SKUs"
              options={skuOptions}
              onChange={(value) => setFilters((current) => ({ ...current, sku: value }))}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs font-medium text-deep-violet-blue/70">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived ({archivedCount})
          </label>
        </div>
        {filterOptions.error ? (
          <p className="mb-2 text-xs text-red-700" role="alert">
            Could not load the customer and SKU filters: {filterOptions.error}
          </p>
        ) : null}
        <PromoUpliftTable
          rows={shownRows}
          anchorPct={anchorPct}
          rate={rate}
          isLoading={loading && !settings}
          emptyState={
            settings && shownRows.length === 0
              ? hasFilters
                ? 'No uplift values apply to this customer and SKU.'
                : 'No uplift values yet.'
              : null
          }
          readOnly={readOnly}
          onEdit={editUplift}
          onHistory={(row) => setHistoryTarget({ kind: 'mechanic', row, shownUplift: shownUplift(row, anchorPct, rate) })}
          onReset={reset.request}
          onArchive={archive.request}
          onRestore={handleUpliftRestore}
          onEvidence={setEvidenceTarget}
        />
      </section>

      {anchorTarget ? (
        <PromoAnchorForm
          key={anchorTarget.customerId ?? 'default'}
          target={anchorTarget}
          settings={rows}
          rate={rate}
          track={track}
          onSaved={handleAnchorSaved}
          onCancel={() => setAnchorTarget(null)}
        />
      ) : null}

      {editingRule ? (
        <PromoRuleDialog
          currentRate={rate}
          settings={rows}
          anchorPct={anchorPct}
          anchorLabel={
            customerAnchor
              ? `${retailerLabel(customerAnchor.customer_name)}'s ordinary-month discount`
              : 'the all-customers ordinary-month discount'
          }
          track={track}
          onSaved={handleRuleSaved}
          onCancel={() => setEditingRule(false)}
        />
      ) : null}

      {editTarget ? (
        <PromoUpliftEditDialog
          key={editTarget.row.id}
          row={editTarget.row}
          shownUplift={editTarget.shownUplift}
          onSave={handleUpliftSave}
          onClose={() => setEditTarget(null)}
        />
      ) : null}

      {evidenceTarget ? (
        <PromoEvidenceDialog key={evidenceTarget.id} row={evidenceTarget} onClose={() => setEvidenceTarget(null)} />
      ) : null}

      {historyTarget ? (
        <PromoHistoryDialog
          key={`${historyTarget.kind}-${historyTarget.row?.id ?? historyTarget.row?.customer_id ?? 'rule'}`}
          target={historyTarget}
          onEdit={historyEdit(historyTarget)}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}

      {addingMechanic ? (
        <PromoMechanicForm track={track} onSaved={handleMechanicAdded} onCancel={() => setAddingMechanic(false)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(reset.target)}
        title="Reset to the rule-based uplift?"
        description="The uplift goes back to the rule and follows the rule and the ordinary-month discount again. Earlier versions stay in History."
        details={
          reset.target
            ? [
                { label: 'Mechanic', value: reset.target.mechanic_label },
                { label: 'Uplift now', value: formatPct(reset.target.uplift_pct) },
              ]
            : []
        }
        confirmLabel="Reset value"
        pendingLabel="Resetting…"
        tone="default"
        isPending={reset.isPending}
        onConfirm={reset.confirm}
        onCancel={reset.cancel}
      />

      <ConfirmDialog
        open={Boolean(archive.target)}
        title="Archive this value?"
        description="The Scenario builder stops using it. Nothing is deleted: turn on Show archived to see it, and restore it from its menu."
        details={
          archive.target
            ? [
                { label: 'Mechanic', value: archive.target.mechanic_label },
                { label: 'Applies to', value: scopeLabel(archive.target) },
                { label: 'Uplift', value: formatPct(shownUplift(archive.target, anchorPct, rate)) },
              ]
            : []
        }
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        isPending={archive.isPending}
        onConfirm={archive.confirm}
        onCancel={archive.cancel}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
