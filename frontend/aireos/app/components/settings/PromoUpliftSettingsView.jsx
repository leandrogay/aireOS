'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import PageLayout from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/formStyles';
import InfoTooltip from '@/components/ui/InfoTooltip';
import RefreshButton from '@/components/ui/RefreshButton';
import Toast from '@/components/ui/Toast';
import usePromoMoments from '@/hooks/usePromoMoments';
import usePromoUpliftSettings from '@/hooks/usePromoUpliftSettings';
import useSkuCatalog from '@/hooks/useSkuCatalog';
import useToast from '@/hooks/useToast';
import {
  adoptPromoAnchor,
  resetPromoUplift,
  savePromoUplift,
} from '@/app/services/promoUpliftsApi';
import { anchorLabel, filteredUpliftRows, overrideTargetChoices, placeholderUplift } from '@/app/utils/promoUpliftSettings';
import { retailerLabel } from '@/app/utils/retailerLabel';

import PromoAnchorDetails from './PromoAnchorDetails';
import PromoAnchorForm from './PromoAnchorForm';
import PromoAnchorTable from './PromoAnchorTable';
import PromoOverrideForm from './PromoOverrideForm';
import PromoUpliftFilters from './PromoUpliftFilters';
import PromoUpliftDetails from './PromoUpliftDetails';
import PromoUpliftTable from './PromoUpliftTable';

const NO_FILTERS = { customer: '', sku: '', mechanic: '' };

/**
 * The Promotion uplift settings page: each customer's ordinary-month
 * discount and the uplift per mechanic the Scenario builder uses. Every write
 * is a new version; the page refetches after one, since an anchor change
 * moves every placeholder value.
 */
export default function PromoUpliftSettingsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { settings, anchors, loading, error } = usePromoUpliftSettings({ refreshKey });
  const moments = usePromoMoments({ refreshKey });
  const catalog = useSkuCatalog();
  const productNames = new Map(catalog.skus.map((sku) => [sku.sku, sku.product_name]));
  const [filters, setFilters] = useState(NO_FILTERS);
  const readOnly = !settings;
  const [anchorTarget, setAnchorTarget] = useState(null);
  const [addingOverride, setAddingOverride] = useState(false);
  const [anchorDetails, setAnchorDetails] = useState(null);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const { toast, notify, dismissToast } = useToast();

  const refresh = () => setRefreshKey((key) => key + 1);
  const rows = settings?.settings ?? [];
  const mechanics = rows.filter((row) => row.scope === 'all');
  const defaultAnchorPct = settings?.default_anchor_pct ?? 20;

  const customerNames = (anchors?.customers ?? []).map((row) => row.customer_name);
  const tableRows = filteredUpliftRows(rows, {
    customerName: filters.customer,
    sku: filters.sku,
    skuRange: catalog.skus.find((row) => row.sku === filters.sku)?.sku_range ?? null,
    mechanicKey: filters.mechanic,
    customers: customerNames,
  });

  // A row resolved for one customer uses that customer's ordinary-month
  // discount (its SKU range's, when filtered to a SKU), as the Scenario
  // builder does; the unfiltered list shows the all-customers one.
  function shownUplift(row) {
    if (!row.follows_anchor) return row.uplift_pct;
    const customerAnchor = anchors?.customers.find((item) => item.customer_name === row.view?.customer_name);
    const rangeAnchor = customerAnchor?.ranges.find((item) => item.sku_range === row.view?.sku_range);
    const anchorPct = rangeAnchor?.anchor_pct ?? customerAnchor?.anchor_pct ?? defaultAnchorPct;
    return placeholderUplift(row.effective_discount_pct, anchorPct);
  }

  function handleFilterChange(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleAnchorSaved(result, target) {
    setAnchorTarget(null);
    refresh();
    notify(
      'success',
      result.changed
        ? 'Ordinary-month discount saved'
        : 'No changes to save'
    );
  }

  async function handleAnchorAdopt(target) {
    try {
      const result = await adoptPromoAnchor(target.customerId, target.skuRange);
      const entry = result.anchor.ranges.find((item) => item.sku_range === target.skuRange) ?? result.anchor;
      setAnchorDetails(null);
      refresh();
      notify('success', `Anchor set to ${anchorLabel(entry)}`);
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleUpliftSave(row, upliftPct) {
    try {
      const result = await savePromoUplift(row.id, { uplift_pct: upliftPct, note: row.note });
      // A save is a new version with a new id, so the open row is now stale.
      setDetailsTarget(null);
      refresh();
      notify('success', result.changed ? 'Saved as an Estimate' : 'No changes to save');
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  }

  async function handleUpliftReset(row) {
    try {
      await resetPromoUplift(row.id);
      setDetailsTarget(null);
      refresh();
      notify('success', row.scope === 'all' ? 'Back to a placeholder' : 'Value removed');
    } catch (err) {
      notify('error', err.message);
    }
  }

  function handleOverrideSaved(result) {
    setAddingOverride(false);
    refresh();
    notify('success', 'Value added');
  }

  return (
    <PageLayout
      title="Promotion uplift settings"
      headerExtra={
        readOnly ? null : (
          <Button
            onClick={() => setAddingOverride(true)}
            className="w-full bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90 md:w-auto"
          >
            <Plus data-icon="inline-start" />
            Add uplift value
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-1">
        <section className={cardClass}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-deep-violet-blue">Ordinary-month discount by customer</h2>
            <RefreshButton onClick={refresh} isRefreshing={loading} label="Refresh promotion uplift settings" />
          </div>
          {error ? (
            <p className="mb-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          {anchors ? (
            <PromoAnchorTable
              anchors={anchors}
              editingKey={anchorTarget?.key ?? null}
              readOnly={readOnly}
              onView={setAnchorDetails}
              onEdit={setAnchorTarget}
              onAdopt={handleAnchorAdopt}
            />
          ) : (
            !error && <p className="text-sm text-deep-violet-blue/70">Loading…</p>
          )}
        </section>

        {anchorDetails ? (
          <PromoAnchorDetails
            key={anchorDetails.key}
            target={anchorDetails}
          windowMonths={anchors?.window_months}
            readOnly={readOnly}
            onEdit={(target) => {
              setAnchorDetails(null);
              setAnchorTarget(target);
            }}
            onAdopt={handleAnchorAdopt}
            onClose={() => setAnchorDetails(null)}
          />
        ) : null}

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
            <h2 className="text-sm font-medium text-deep-violet-blue">Mechanics with no uplift value</h2>
            <p className="mt-1 text-xs text-deep-violet-blue/70">
              {settings.unmapped_mechanics
                .map((row) => `${row.promotion_mechanic} (${row.promotions} promotion${row.promotions === 1 ? '' : 's'})`)
                .join(' · ')}
            </p>
          </section>
        ) : null}

        <section className={cardClass}>
          <h2 className="mb-2 flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            Uplift by mechanic
            <InfoTooltip label="About uplift">
              How much more or less a month with this mechanic sells than an ordinary month, which the forecast already
              reflects. Used when planning future promotions in the Scenario builder.
            </InfoTooltip>
          </h2>
          <PromoUpliftFilters
            filters={filters}
            customers={customerNames}
            skuOptions={overrideTargetChoices(catalog.skus).skus}
            mechanicOptions={mechanics.map((row) => ({ value: row.mechanic_key, label: row.mechanic_label }))}
            onChange={handleFilterChange}
            onReset={() => setFilters(NO_FILTERS)}
          />
          <PromoUpliftTable
            rows={tableRows}
            shownUplift={shownUplift}
            moments={moments.data}
            productNames={productNames}
            readOnly={readOnly}
            onView={(row, options) => setDetailsTarget({ row, editing: Boolean(options?.editing) })}
            onReset={handleUpliftReset}
          />
          {moments.error ? (
            <p className="mt-2 text-xs text-red-600" role="alert">
              Moments could not be loaded: {moments.error}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-deep-violet-blue/60">
            Placeholder values move with each customer&apos;s ordinary-month discount ({defaultAnchorPct}% for all
            customers).
          </p>
        </section>

        {addingOverride && anchors ? (
          <PromoOverrideForm
            mechanics={mechanics}
            customers={anchors.customers}
            catalog={catalog}
            moments={moments.data}
            initial={filters}
            onSaved={handleOverrideSaved}
            onCancel={() => setAddingOverride(false)}
          />
        ) : null}

        {detailsTarget ? (
          <PromoUpliftDetails
            key={detailsTarget.row.id}
            row={detailsTarget.row}
            shownUplift={shownUplift(detailsTarget.row)}
            moments={moments.data}
            startEditing={detailsTarget.editing}
            readOnly={readOnly}
            onSave={handleUpliftSave}
            onReset={handleUpliftReset}
            onClose={() => setDetailsTarget(null)}
          />
        ) : null}

        <Toast toast={toast} onDismiss={dismissToast} />
      </div>
    </PageLayout>
  );
}
