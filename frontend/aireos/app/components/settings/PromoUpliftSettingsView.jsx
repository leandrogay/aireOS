'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cardClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import RefreshButton from '@/components/ui/RefreshButton';
import Toast from '@/components/ui/Toast';
import usePromoUpliftSettings from '@/hooks/usePromoUpliftSettings';
import useToast from '@/hooks/useToast';
import {
  PROMO_UPLIFTS_DEMO,
  resetPromoAnchor,
  resetPromoUplift,
  savePromoUplift,
} from '@/app/services/promoUpliftsApi';
import { retailerLabel } from '@/app/utils/retailerLabel';

import PromoAnchorForm from './PromoAnchorForm';
import PromoAnchorTable from './PromoAnchorTable';
import PromoHistoryPanel from './PromoHistoryPanel';
import PromoOverrideForm from './PromoOverrideForm';
import PromoUpliftTable from './PromoUpliftTable';

/**
 * The Promotion Uplift Settings page (Forecast > Promotion Uplift Settings):
 * each customer's ordinary-month discount, the uplift per mechanic used when
 * planning future promotions in the Scenario builder, and promotion
 * mechanics that match no setting. Every write is a new version (nothing is
 * deleted), recorded as UPDATED_BY; after a write the page refetches, since
 * an anchor change moves every placeholder value.
 *
 * While PROMO_UPLIFTS_DEMO is on (services/promoUpliftsApi.js), every
 * button works against an in-memory demo and nothing is saved.
 */
export default function PromoUpliftSettingsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { settings, anchors, loading, error } = usePromoUpliftSettings({ refreshKey });
  const readOnly = !settings;
  const [anchorTarget, setAnchorTarget] = useState(null);
  const [addingOverride, setAddingOverride] = useState(false);
  const [historyTarget, setHistoryTarget] = useState(null);
  const { toast, notify, dismissToast } = useToast();

  const refresh = () => setRefreshKey((key) => key + 1);
  const rows = settings?.settings ?? [];
  const placeholderInUse = rows.some((row) => row.source === 'placeholder');

  function handleAnchorSaved(result, target) {
    setAnchorTarget(null);
    refresh();
    notify(
      'success',
      result.changed
        ? `Ordinary-month discount for ${target.name} saved`
        : 'No changes to save: the discount is already set to this value'
    );
  }

  async function handleAnchorReset(row) {
    try {
      const result = await resetPromoAnchor(row.customer_id);
      refresh();
      notify('success', `${retailerLabel(row.customer_name)} now uses ${result.anchor.anchor_pct}% (from its data)`);
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleUpliftSave(row, upliftPct) {
    try {
      const result = await savePromoUplift(row.id, { uplift_pct: upliftPct, note: row.note });
      refresh();
      notify('success', result.changed ? `${row.mechanic_label} saved as an Estimate` : 'No changes to save');
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  }

  async function handleUpliftReset(row) {
    try {
      await resetPromoUplift(row.id);
      refresh();
      notify('success', row.scope === 'all' ? `${row.mechanic_label} is a placeholder again` : 'Value removed');
    } catch (err) {
      notify('error', err.message);
    }
  }

  function handleOverrideSaved(result) {
    setAddingOverride(false);
    refresh();
    notify('success', `${result.setting.mechanic_label} value added`);
  }

  return (
    <div className="grid gap-1">
      <section className={cardClass}>
        <p className="text-sm text-deep-violet-blue/80">
          Uplift is how much more or less a month with a promotion mechanic sells than an ordinary month. The forecast
          already reflects an ordinary month. These values are used when planning <b>future</b> promotions in Forecast ›
          Scenario builder.
        </p>
        {PROMO_UPLIFTS_DEMO ? (
          <p className="mt-2 rounded-md border border-violet bg-lavander/60 px-3 py-2 text-xs text-deep-violet-blue" role="status">
            <b>Demo mode:</b> every button works, but nothing is saved. Changes last until you reload this tab, and the
            suggested discounts are made up for the demo.
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {placeholderInUse ? (
          <p className="mt-2 text-xs text-deep-violet-blue/60">
            <b>Placeholder values</b> follow a simple rule and are not yet measured from sales data.
          </p>
        ) : null}
      </section>

      <section className={cardClass}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-deep-violet-blue">Ordinary-month discount by customer</h2>
          <RefreshButton onClick={refresh} isRefreshing={loading} label="Refresh promotion uplift settings" />
        </div>
        {anchors ? (
          <PromoAnchorTable
            anchors={anchors}
            editingKey={anchorTarget?.key ?? null}
            readOnly={readOnly}
            onEdit={setAnchorTarget}
            onReset={handleAnchorReset}
            onHistory={(row) =>
              setHistoryTarget({ kind: 'anchor', id: row.customer_id, title: retailerLabel(row.customer_name) })
            }
          />
        ) : (
          <p className="text-sm text-deep-violet-blue/60">Loading…</p>
        )}
      </section>

      {anchorTarget ? (
        <PromoAnchorForm
          key={anchorTarget.key}
          target={anchorTarget}
          settings={rows}
          onSaved={handleAnchorSaved}
          onCancel={() => setAnchorTarget(null)}
        />
      ) : null}

      {settings?.unmapped_mechanics?.length ? (
        <section className={cardClass} role="status">
          <h2 className="text-sm font-medium text-deep-violet-blue">These promotion mechanics have no uplift value yet</h2>
          <p className="mt-1 text-xs text-deep-violet-blue/70">
            {settings.unmapped_mechanics
              .map((row) => `${row.promotion_mechanic} (${row.promotions} promotion${row.promotions === 1 ? '' : 's'})`)
              .join(' · ')}
          </p>
        </section>
      ) : null}

      <section className={cardClass}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-deep-violet-blue">Uplift by mechanic</h2>
          {readOnly ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddingOverride(true)}
              className={secondaryButtonClass}
            >
              <Plus aria-hidden="true" />
              Add customer / SKU value
            </Button>
          )}
        </div>
        <PromoUpliftTable
          rows={rows}
          defaultAnchorPct={settings?.default_anchor_pct ?? 20}
          readOnly={readOnly}
          onSave={handleUpliftSave}
          onReset={handleUpliftReset}
          onHistory={(row) => setHistoryTarget({ kind: 'mechanic', id: row.mechanic_key, title: row.mechanic_label })}
        />
        <p className="mt-2 text-xs text-deep-violet-blue/60">
          All-customers placeholder values are shown at the all-customers discount ({settings?.default_anchor_pct ?? 20}%);
          the Scenario builder recalculates them from each customer&apos;s own ordinary-month discount.
        </p>
      </section>

      {addingOverride && anchors ? (
        <PromoOverrideForm
          mechanics={rows.filter((row) => row.scope === 'all')}
          customers={anchors.customers}
          onSaved={handleOverrideSaved}
          onCancel={() => setAddingOverride(false)}
        />
      ) : null}

      {historyTarget ? (
        <PromoHistoryPanel
          key={`${historyTarget.kind}-${historyTarget.id}`}
          target={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
